import { Request, Response } from "express";
import { Connection } from "typeorm";
import * as B64 from "base64-img";
import * as Fs from "fs";

import { EventsToAttendees } from "../../model/entity/EventsToAttendees";
import { getRequestingUser } from "../middleware/loggedOnly";
import { Event } from "../../model/entity/Event";
import { DbConnection } from "../../utils/DbConnection";
import { Calendar } from "../../model/entity/Calendar";
import { User } from "../../model/entity/User";
import { ApiException } from "../../utils/apiException";
import { CalendarsToOwners } from "../../model/entity/CalendarsToOwners";
import { EventView } from "../views/EventView";

import { image as DEFAULT_IMAGE } from "../../../resources/images/event_default.json";
import { CalendarRole } from "../../utils/types/CalendarRole";
import { EventStatus } from "../../utils/types/EventStatus";


const MAX_FILE_SIZE: number = 2000000;


export async function getEventInfo(req: Request, res: Response) {
    const requestingUser: User = getRequestingUser(req);

    const eventId: number = req.params.event_id;

    const conn: Connection = await DbConnection.getConnection();

    // Recover event and check if exists
    const event: Event = await Event.getEventById(conn, eventId);
    if (!event) {
        throw new ApiException(404, "Event not found");
    }

    // Check if the Event is accessible by the requesting User
    const userCalendarRelation = await CalendarsToOwners.findCalendarRelation(
        conn,
        event.calendar.id,
        requestingUser.id
    );
    if (event.visibility !== "public" && !userCalendarRelation) {
        throw new ApiException(403, "Event not accessible");
    }

    const eventAttendee = await EventsToAttendees.getRelation(conn, eventId, requestingUser.id);
    const status = eventAttendee ? eventAttendee.status : EventStatus.Invited;

    return res.status(200).json({
        message: "OK",
        event: EventView.formatEventWithStatus(event, status)
    });
}

export async function getEventAttendees(req: Request, res: Response) {
    const requestingUser = getRequestingUser(req);

    const eventId = req.params.event_id;

    const conn = await DbConnection.getConnection();

    // Get the Event
    const eventWithAttendees = await Event.getEventWithAttendeesById(conn, eventId);
    if (!eventWithAttendees) {
        throw new ApiException(403, "Event not accessible");
    }

    // Check if the Event is accessible by the requesting User
    const userCalendarRelation = await CalendarsToOwners.findCalendarRelation(
        conn,
        eventWithAttendees.calendar.id,
        requestingUser.id
    );
    if (eventWithAttendees.visibility !== "public" && !userCalendarRelation) {
        throw new ApiException(403, "Event not accessible");
    }

    return res.status(200).json({
        message: "OK",
        attendees: eventWithAttendees.attendees.map(EventView.formatAttendee)
    });
}

export async function inviteUsersToEvent(req: Request, res: Response) {
    const requestingUser = getRequestingUser(req);

    const eventId = req.params.event_id;
    const usersToInvite: string[] = req.body.users;
    if (!usersToInvite || !usersToInvite.length) {
        throw new ApiException(400, "Bad Request");
    }

    const conn = await DbConnection.getConnection();

    // Get the Event
    const eventWithAttendees = await Event.getEventWithAttendeesById(conn, eventId);
    if (!eventWithAttendees) {
        throw new ApiException(403, "Event not accessible");
    }

    // Get Calendar
    const calendar = await Calendar.getCalendarWithOwners(conn, eventWithAttendees.calendar.id);
    if (!calendar.userCanCreateEvents(requestingUser)) {
        throw new ApiException(403, "Event not accessible");
    }

    // Get all Users
    const usersPromises = usersToInvite.map(userPseudo => User.findByPseudo(conn, userPseudo));
    const users = await Promise.all(usersPromises);

    const indexNonExistingUser = users.findIndex(u => !u);
    if (indexNonExistingUser !== -1) {
        throw new ApiException(404, `User "${usersToInvite[indexNonExistingUser]}" does not exist`);
    }

    // Make sure users to invite aren't already in the list
    const existingUserIds = new Set(eventWithAttendees.attendees.map(eta => eta.attendee_id));
    const indexUserAlreadyInList = users.findIndex(u => existingUserIds.has(u.id));
    if (indexUserAlreadyInList !== -1) {
        throw new ApiException(409, `User "${usersToInvite[indexUserAlreadyInList]}" already invited`);
    }

    // Add the users in the attendees list
    const newEventsToAttendees = users.map(u => {
        const eta = new EventsToAttendees(eventWithAttendees.id, u.id, EventStatus.Invited);
        eta.attendee = u;
        return eta;
    });
    await conn.manager.save(newEventsToAttendees);

    // Add external users in calendar as "Outsider"
    const externalUsers = newEventsToAttendees
        .filter(eta => calendar.owners.findIndex(o => o.owner_id === eta.attendee_id) === -1)
        .map(eta => new CalendarsToOwners(calendar.id, eta.attendee_id, CalendarRole.Outsider, true));
    await conn.manager.save(externalUsers);

    const attendees = [
        ...eventWithAttendees.attendees,
        ...newEventsToAttendees
    ];

    return res.status(201).json({
        message: "User(s) successfully invited",
        attendees: attendees.map(EventView.formatAttendee)
    });
}

export async function editEvent(req: Request, res: Response) {
    const requestingUser: User = getRequestingUser(req);

    const eventId: number = req.params.event_id;

    const name = req.body.name;
    const description = req.body.description || "";
    const location = req.body.location || "";
    const type = req.body.type;
    const visibility = req.body.visibility;
    const start_time = req.body.start_time;
    const end_time = req.body.end_time;
    if (!name || !type || !visibility || !start_time || !end_time) {
        throw new ApiException(400, "Bad request");
    }

    const conn: Connection = await DbConnection.getConnection();

    // Recover event and check if exists
    const event: Event = await Event.getEventById(conn, eventId);
    if (!event) {
        throw new ApiException(403, "Action not allowed");
    }

    // Check if requesting user is a member of the calendar
    const calendar: Calendar = event.calendar;
    const calendarRelation = await CalendarsToOwners
        .findCalendarRelation(conn, calendar.id, requestingUser.id);
    if (!calendarRelation
        || (calendarRelation.role !== CalendarRole.Admin
            && calendarRelation.role !== CalendarRole.Actor)) {
        throw new ApiException(403, "Action not allowed");
    }

    // Update Event information
    event.name = name;
    event.description = description;
    event.location = location;
    event.type = type;
    event.visibility = visibility;
    event.startTime = start_time;
    event.endTime = end_time;
    const savedEvent = await conn.manager.save(event);

    return res.status(200).json({
        message: "OK",
        event: EventView.formatEvent(savedEvent)
    });
}

export async function uploadEventImage(req: Request, res: Response) {

    const requestingUser: User = getRequestingUser(req);

    const event_id: number = req.params.event_id;
    const file: any = req.file;

    const conn: Connection = await DbConnection.getConnection();

    // Recover event and check if exists
    const event: Event = await Event.getEventById(conn, event_id);
    if (!event) {
        throw new ApiException(404, "Event not found");
    }

    const calendar: Calendar = event.calendar;

    // Check if requesting user is a member of the calendar
    const calendarRelation = await CalendarsToOwners
        .findCalendarRelation(conn, calendar.id, requestingUser.id);
    if (!calendarRelation
        || (calendarRelation.role !== CalendarRole.Admin
            && calendarRelation.role !== CalendarRole.Actor)) {
        throw new ApiException(403, "Action not allowed");
    }

    if (!file) {
        throw new ApiException(400, "File not found");
    }

    // Check if max file size isn't exceeded
    if (file.size > MAX_FILE_SIZE) {
        throw new ApiException(413, "Image should not exceed 2MB");
    }

    // Convert to base64
    let b64: string;

    try {
        b64 = B64.base64Sync(file.path);
    } catch (e) {
        throw new ApiException(500, "Invalid image format");
    }

    // Delete file from filesystem
    Fs.unlinkSync(file.path);

    // Save new image as event image
    event.image = new Buffer(b64);
    const eventRepo = conn.getRepository(Event);

    await eventRepo.save(event);

    return res.status(200).json({
        message: "OK"
    });
}

export async function getEventImage(req: Request, res: Response) {
    const requestingUser: User = getRequestingUser(req);

    const event_id: number = req.params.event_id;

    const conn: Connection = await DbConnection.getConnection();

    // Recover event and check if exists
    const event: Event = await Event.getEventById(conn, event_id);
    if (!event) {
        throw new ApiException(404, "Event not found");
    }

    const calendar: Calendar = event.calendar;

    // Check if requesting user is a member of the calendar
    const eventRelation = await EventsToAttendees.getRelation(conn, event.id, requestingUser.id);
    if (event.visibility !== "public"
        && !eventRelation) {
        throw new ApiException(403, "Action not allowed");
    }

    return res.status(200).json({
        message: "OK",
        image: event.image ? event.image.toString() : DEFAULT_IMAGE
    });
}

export async function deleteEvent(req: Request, res: Response) {

    const requestingUser: User = getRequestingUser(req);

    const event_id: number = req.params.event_id;

    const conn: Connection = await DbConnection.getConnection();

    // Recover event and check if exists
    const event: Event = await Event.getEventById(conn, event_id);
    if (!event) {
        throw new ApiException(404, "Event not found");
    }

    const calendar: Calendar = event.calendar;

    // Check if requesting user is a member of the calendar
    const calendarRelation = await CalendarsToOwners
        .findCalendarRelation(conn, calendar.id, requestingUser.id);
    if (!calendarRelation
        || (calendarRelation.role !== CalendarRole.Admin
            && calendarRelation.role !== CalendarRole.Actor)) {
        throw new ApiException(403, "Action not allowed");
    }

    // Remove Event from calendar
    await Event.deleteById(conn, event.id);

    return res.status(200).json({
        message: "Event successfully deleted"
    });
}

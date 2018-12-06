import {Request, Response} from 'express';
import * as Jwt from 'jsonwebtoken'

import {User} from "../../model/entity/User";
import {ApiException} from "../../utils/apiException";
import {UserView} from "../views/UserView";
import {getRequestingUser} from '../middleware/loggedOnly';
import {EmailSender} from '../../utils/emailSender';
import {AccountVerification} from '../../utils/accountVerification'
import {DbConnection} from "../../utils/DbConnection";
import {PendingUser} from '../../model/entity/PendingUser';
import { getReqUrl } from '../../utils/getReqUrl';
import { CalendarsToOwnersView } from '../views/CalendarsToOwnersView';
import { Calendar } from '../../model/entity/Calendar';
import { CalendarsToOwners } from '../../model/entity/CalendarsToOwners';


//
// Create a new User and save it in the DataBase
//
export async function createUser(req: Request, res: Response) {
    const email = req.body.email;
    const pseudo = req.body.pseudo;
    const password = req.body.password;
    if (!email || !pseudo || !password) {
        throw new ApiException(400, "Bad request");
    }

    const conn = await DbConnection.getConnection();

    // Check if user exists before creating PendingUser
    const userAlreadyExists = await User.alreadyExists(conn, email, pseudo);
    if (userAlreadyExists) {
        throw new ApiException(409, "Pseudo or email already exists");
    }

    // Create a new PendingUser
    const validation_link = AccountVerification.generateLink();
    const pendingUser = new PendingUser(
        pseudo,
        email,
        await PendingUser.cipherPassword(password),
        validation_link
    );
    if (!pendingUser.isValid())
        throw new ApiException(400, "Invalid fields in User");

    // Save the created PendingUser
    const createdPendingUser = await conn.manager.save(pendingUser);

    // Generate link for account verification
    let reqUrl = process.env.API_HOST || getReqUrl(req);
    if (!reqUrl.endsWith('/')) {
        reqUrl += '/';
    }
    const link = reqUrl + 'auth/validate-email/' + validation_link;

    // Send a verification email
    EmailSender.sendEmail(createdPendingUser.email, 'Account Verification', link);

    let response: any = {
        message: 'A link has been sent to your email address, please click on it in order to confirm your email',
        user: UserView.formatPendingUser(createdPendingUser)
    };
    if (!process.env.EMAIL_ENABLED) {
        response['link'] = link;
    }

    return res.status(201).json(response);
}


//
// Validate email for a specific User
//
export async function confirmUserEmail(req: Request, res: Response) {
    const validationUuid: string = req.params.uuid;

    const conn = await DbConnection.getConnection();

    // Find PendingUser using validation link
    const pendingUser = await PendingUser.findPendingUserByValidationUuid(conn, validationUuid);
    if (!pendingUser) {
        throw new ApiException(404, "User not found");
    }

    // Create valid User
    const user: User = new User(
        pendingUser.pseudo,
        pendingUser.email,
        pendingUser.cipheredPassword
    );
    const createdUser = await conn.manager.save(user);
    await conn.manager.remove(pendingUser);

    // Create a default Calendar for the new User
    const calendar = new Calendar("Main Calendar");
    const createdCalendar = await conn.manager.save(calendar);
    const calendarsToOwners = new CalendarsToOwners(createdCalendar.id, user.id);
    await conn.manager.save(calendarsToOwners);

    return res.status(201).json({
        message: "User has been successfully created",
        user: UserView.formatUser(createdUser)
    });
}


//
// Log a user in and return a session token
//
export async function login(req: Request, res: Response) {
    const email: string = req.body.email;
    const password: string = req.body.password;
    if (!email || !password) {
        throw new ApiException(400, "Bad request");
    }

    const conn = await DbConnection.getConnection();

    const user = await User.findByEmail(conn, email);
    if (!user
        || !await user.checkPassword(password)) {
        throw new ApiException(403, "Bad user or password");
    }

    const token_payload = {id: user.id};
    const token = Jwt.sign(token_payload, process.env.JWT_ENCODE_KEY);

    res.status(200).json({
        message: 'Authentication successful',
        access_token: token,
        user: UserView.formatUser(user)
    });
}


//
// Get information about a specific User
//
export async function getUser(req: Request, res: Response) {
    const pseudo: string = req.params.pseudo;

    const conn = await DbConnection.getConnection();

    const user = await User.findByPseudo(conn, pseudo);
    if (!user) {
        throw new ApiException(404, "User not found");
    }

    return res.status(200).json({
        message: "OK",
        user: UserView.formatUser(user)
    });
}


//
// Edit a User's information
//
export async function editUser(req: Request, res: Response) {
    let user = getRequestingUser(req);
    if (user.pseudo !== req.params.pseudo) {
        throw new ApiException(403, "Action not allowed");
    }

    const old_pseudo = user.pseudo;
    const old_email = user.email;
    user.pseudo = req.body.pseudo || user.pseudo;
    user.email = req.body.email || user.email;

    if (!user.isValid()) {
        throw new ApiException(400, "Invalid fields in User");
    }

    const conn = await DbConnection.getConnection();

    const alreadyExists = await User.alreadyExists(
        conn,
        user.email === old_email ? null : user.email,
        user.pseudo === old_pseudo ? null : old_pseudo
    );
    if (alreadyExists) {
        throw new ApiException(409, "Pseudo or email already exists");
    }

    const updatedUser = await conn.manager.save(user);

    return res.status(200).json({
        message: "User updated",
        user: UserView.formatUser(updatedUser)
    });
}


//
// Delete user
//
export async function deleteUser(req: Request, res: Response) {
    let user: User = getRequestingUser(req);
    if (user.pseudo !== req.params.pseudo) {
        throw new ApiException(403, "Action not allowed");
    }

    const conn = await DbConnection.getConnection();
    await User.deleteUser(conn, user.id);

    return res.status(200).json({
        message: "User deleted"
    });
}


//
// Get all groups a User belongs to
//
export async function getUserGroups(req: Request, res: Response) {
    let user: User = getRequestingUser(req);
    if (user.pseudo !== req.params.pseudo) {
        throw new ApiException(403, "Action not allowed");
    }

    const conn = await DbConnection.getConnection();

    const groups = await User.getAllGroups(conn, user.id);

    return res.status(200).json({
        message: "OK",
        groups: UserView.formatUserGroupList(groups)
    });
}


//
// Get all Calendars of a User
//
export async function getUserCalendars(req: Request, res: Response) {
    const pseudo = req.params.pseudo;
    const requestingUser = getRequestingUser(req);
    if (pseudo !== requestingUser.pseudo) {
        throw new ApiException(403, "Action not allowed");
    }

    const conn = await DbConnection.getConnection();
    const calendars = await User.getAllCalendars(conn, requestingUser.id);

    return res.status(200).json({
        message: "OK",
        calendars: CalendarsToOwnersView.formatCalendarsToOwnersList(calendars)
    });
}

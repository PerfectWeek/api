import { Router } from "express";
import * as AsyncHandler from "express-async-handler";

import * as CalendarController from "../../controllers/CalendarController"
import * as AssistantController from "../../controllers/AssistantController"
import { loggedOnly } from "../../middleware/loggedOnly";

const router = Router();

router.post("/", AsyncHandler(loggedOnly), AsyncHandler(CalendarController.createCalendar));

router.get("/:calendar_id", AsyncHandler(loggedOnly), AsyncHandler(CalendarController.getCalendarInfo));

router.put("/:calendar_id", AsyncHandler(loggedOnly), AsyncHandler(CalendarController.editCalendar));

router.delete("/:calendar_id", AsyncHandler(loggedOnly), AsyncHandler(CalendarController.deleteCalendar));

router.post("/:calendar_id/events", AsyncHandler(loggedOnly), AsyncHandler(CalendarController.createEvent));

router.get("/:calendar_id/events", AsyncHandler(loggedOnly), AsyncHandler(CalendarController.getCalendarEvents));

router.get("/:calendar_id/assistant/find-best-slots", AsyncHandler(loggedOnly), AsyncHandler(AssistantController.findBestSlots));

router.get("/:calendar_id/assistant/get-event-suggestions", AsyncHandler(loggedOnly), AsyncHandler(AssistantController.getEventSuggestions));

export default router;

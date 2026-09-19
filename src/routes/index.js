/**
 * 路由总装：按业务域拆分，每个文件只管自己那一块。
 */
import { Router } from "express";
import { registerCore } from "./core.js";
import { registerProfile } from "./profile.js";
import { registerApplications } from "./applications.js";
import { registerInterviews } from "./interviews.js";
import { registerReviews } from "./reviews.js";
import { registerResume } from "./resume.js";
import { registerOffers } from "./offers.js";
import { registerAgent } from "./agent.js";
import { registerMeeting } from "./meeting.js";
import { registerTheme } from "./theme.js";

export function createRouter(ctx) {
  const router = Router();
  registerCore(router, ctx);
  registerProfile(router, ctx);
  registerApplications(router, ctx);
  registerInterviews(router, ctx);
  registerReviews(router, ctx);
  registerResume(router, ctx);
  registerOffers(router, ctx);
  registerAgent(router, ctx);
  registerMeeting(router, ctx);
  registerTheme(router, ctx);
  return router;
}

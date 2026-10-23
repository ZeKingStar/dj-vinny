import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("expirer les passes", { hours: 1 }, internal.soirees.expirer);
export default crons;

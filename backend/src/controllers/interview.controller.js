import { handle } from "../shared/handle.js";
import { toInterviewDoc } from "../shared/mongoShape.js";

export const createInterviewController = ({ interviewService }) => ({
  list: handle("Error fetching interviews", async (req, res) => {
    const rawInterviewer = req.header("x-clerk-id") || req.query.interviewerId;
    const interviews = await interviewService.list({ rawInterviewer });
    res.status(200).json(interviews.map(toInterviewDoc));
  }),

  create: handle("Error creating interview", async (req, res) => {
    const body = req.body ?? {};
    const rawInterviewer = req.header("x-clerk-id") || body.interviewerId || body.interviewerClerkId;
    const interview = await interviewService.create({ rawInterviewer, body });
    res.status(201).json(toInterviewDoc(interview));
  }),

  get: handle("Error fetching interview", async (req, res) => {
    res.status(200).json(toInterviewDoc(await interviewService.get(req.params.id)));
  }),

  updateStatus: handle("Error updating status", async (req, res) => {
    const updated = await interviewService.updateStatus(req.params.id, req.body?.status);
    res.status(200).json(toInterviewDoc(updated));
  }),

  update: handle("Error updating interview", async (req, res) => {
    const updated = await interviewService.update(req.params.id, req.body);
    res.status(200).json(toInterviewDoc(updated));
  }),

  remove: handle("Error deleting interview", async (req, res) => {
    await interviewService.remove(req.params.id);
    res.status(200).json({ message: "Interview deleted" });
  }),

  stats: handle("Stats failed", async (req, res) => {
    res.status(200).json(await interviewService.dashboardStats());
  }),

  activity: handle("Activity failed", async (req, res) => {
    res.status(200).json(await interviewService.recentActivity());
  }),
});

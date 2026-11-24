import { handle } from "../shared/handle.js";
import { toInterviewDoc } from "../shared/mongoShape.js";

// What an invited candidate may see of an interview: never questions, notes or the interviewer.
const toCandidateRoomDoc = (iv) => ({
  _id: iv.id,
  candidateName: iv.candidateName,
  role: iv.role,
  interviewType: iv.interviewType,
  scheduledAt: iv.scheduledAt,
  duration: iv.duration,
  status: iv.status,
  codeLanguage: iv.codeLanguage,
  codeSnapshot: iv.codeSnapshot,
  company: iv.company,
  interviewLanguage: iv.interviewLanguage,
  aiInterviewerEnabled: iv.aiInterviewerEnabled,
  // How many questions there are, never the questions themselves.
  questionCount: Array.isArray(iv.questions) ? iv.questions.length : 0,
  viewer: "candidate",
});

export const createInterviewController = ({ interviewService }) => ({
  list: handle("Error fetching interviews", async (req, res) => {
    const interviews = await interviewService.list(req.principal);
    res.status(200).json(interviews.map(toInterviewDoc));
  }),

  create: handle("Error creating interview", async (req, res) => {
    const interview = await interviewService.create(req.principal, req.body ?? {});
    res.status(201).json(toInterviewDoc(interview));
  }),

  get: handle("Error fetching interview", async (req, res) => {
    res.status(200).json(toInterviewDoc(await interviewService.get(req.principal, req.params.id)));
  }),

  updateStatus: handle("Error updating status", async (req, res) => {
    const updated = await interviewService.updateStatus(req.principal, req.params.id, req.body?.status);
    res.status(200).json(toInterviewDoc(updated));
  }),

  update: handle("Error updating interview", async (req, res) => {
    const updated = await interviewService.update(req.principal, req.params.id, req.body);
    res.status(200).json(toInterviewDoc(updated));
  }),

  remove: handle("Error deleting interview", async (req, res) => {
    await interviewService.remove(req.principal, req.params.id);
    res.status(200).json({ message: "Interview deleted" });
  }),

  stats: handle("Stats failed", async (req, res) => {
    res.status(200).json(await interviewService.dashboardStats(req.principal));
  }),

  activity: handle("Activity failed", async (req, res) => {
    res.status(200).json(await interviewService.recentActivity(req.principal));
  }),

  invite: handle("Error creating invite", async (req, res) => {
    res.status(200).json(await interviewService.createInvite(req.principal, req.params.id));
  }),

  room: handle("Error fetching interview", async (req, res) => {
    const { viewer, interview } = await interviewService.roomView(req.principal, req.params.id);
    res.status(200).json(viewer === "candidate" ? toCandidateRoomDoc(interview) : toInterviewDoc(interview));
  }),
});

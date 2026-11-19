import { handle } from "../../shared/handle.js";
import { toInterviewDoc } from "../../shared/mongoShape.js";

export const createQuestionController = ({ questionService }) => ({
  generate: handle("Failed to generate questions", async (req, res) => {
    const identityKey = req.user?.clerkID || req.user?.id || "anon";
    const result = await questionService.generate({ interviewId: req.params.id, identityKey });
    res.status(200).json(result);
  }),

  approve: handle("Failed to resolve approval", async (req, res) => {
    const { jobId, approved, questions } = req.body ?? {};
    const result = await questionService.approve({ interviewId: req.params.id, jobId, approved, questions });
    if (result.status === "rejected") return res.status(200).json({ status: "rejected" });
    return res.status(200).json(toInterviewDoc(result.interview));
  }),
});

import { handle } from "../shared/handle.js";
import { toInterviewDoc } from "../shared/mongoShape.js";

export const createQuestionController = ({ questionService }) => ({
  generate: handle("Failed to generate questions", async (req, res) => {
    const result = await questionService.generate(req.principal, req.params.id);
    res.status(200).json(result);
  }),

  approve: handle("Failed to resolve approval", async (req, res) => {
    const result = await questionService.approve(req.principal, req.params.id, req.body ?? {});
    if (result.status === "rejected") return res.status(200).json({ status: "rejected" });
    return res.status(200).json(toInterviewDoc(result.interview));
  }),
});

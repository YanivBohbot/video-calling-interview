import { handle } from "../shared/handle.js";
import { toUserDoc } from "../shared/mongoShape.js";

export const createUserController = ({ userService }) => ({
  getMe: handle("Fetch user failed", async (req, res) => {
    res.status(200).json(toUserDoc(await userService.getMe(req.principal)));
  }),

  updateMe: handle("Update failed", async (req, res) => {
    res.status(200).json(toUserDoc(await userService.updateMe(req.principal, req.body)));
  }),

  myStats: handle("Stats failed", async (req, res) => {
    res.status(200).json(await userService.getMyStats(req.principal));
  }),
});

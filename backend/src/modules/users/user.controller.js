import { handle } from "../../shared/handle.js";
import { toUserDoc } from "../../shared/mongoShape.js";

export const createUserController = ({ userService }) => ({
  list: handle("Fetch users failed", async (req, res) => {
    const users = await userService.listUsers();
    res.status(200).json(users.map(toUserDoc));
  }),

  create: handle("Create user failed", async (req, res) => {
    const user = await userService.createUser(req.body);
    res.status(201).json(toUserDoc(user));
  }),

  getByClerkId: handle("Fetch user failed", async (req, res) => {
    const user = await userService.getByClerkId(req.params.clerkId);
    res.status(200).json(toUserDoc(user));
  }),

  update: handle("Update failed", async (req, res) => {
    const user = await userService.updateProfile(req.params.clerkId, req.body);
    res.status(200).json(toUserDoc(user));
  }),

  stats: handle("Stats failed", async (req, res) => {
    res.status(200).json(await userService.getStats(req.params.clerkId));
  }),
});

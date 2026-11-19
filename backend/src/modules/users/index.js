import { createUserRepository } from "./user.repository.js";
import { createUserService } from "./user.service.js";
import { createUserController } from "./user.controller.js";
import { createUserRouter } from "./user.routes.js";

// Wires the users feature: repository → service → controller → router.
export const createUsersModule = ({ prisma }) => {
  const userRepository = createUserRepository({ prisma });
  const userService = createUserService({ userRepository });
  const userController = createUserController({ userService });
  const router = createUserRouter({ userController });
  return { userRepository, userService, userController, router };
};

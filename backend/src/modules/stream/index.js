import { createStreamService } from "./stream.service.js";
import { createStreamController } from "./stream.controller.js";
import { createStreamRouter } from "./stream.routes.js";

export const createStreamModule = ({ getStreamClient, now }) => {
  const streamService = createStreamService({ getStreamClient, now });
  const streamController = createStreamController({ streamService });
  const router = createStreamRouter({ streamController });
  return { streamService, streamController, router };
};

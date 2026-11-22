import { modelFallbackMiddleware } from "langchain";

// On a model error, retry the call with the fallback model ("provider:model").
export const withFallback = (fallbackModel) => (fallbackModel ? [modelFallbackMiddleware(fallbackModel)] : []);

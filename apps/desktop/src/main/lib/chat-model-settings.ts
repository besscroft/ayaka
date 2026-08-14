export function getChatSamplingSettings(input: {
  reasoningModel: boolean;
  temperature: number;
  topP: number;
}): { temperature?: number; topP?: number } {
  if (input.reasoningModel) return {};
  return { temperature: input.temperature, topP: input.topP };
}

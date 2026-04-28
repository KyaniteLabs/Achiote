import { describe, expect, it } from 'vitest';
import { executeToolDefinition, defaultToolExecutionContext, ToolExecutionError } from '../src/tools/tool-registry.js';

describe('tool registry edge cases', () => {
  it('throws ToolExecutionError when plan_dish_research receives completely invalid input', async () => {
    await expect(
      executeToolDefinition('plan_dish_research', { garbage: true }, defaultToolExecutionContext),
    ).rejects.toThrow('Could not extract a valid food memory');
  });

  it('throws ToolExecutionError with memory_input_invalid code for invalid memory', async () => {
    try {
      await executeToolDefinition('plan_dish_research', { foo: 123 }, defaultToolExecutionContext);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      expect((err as ToolExecutionError).code).toBe('memory_input_invalid');
    }
  });

  it('throws ToolExecutionError when generate_recipe receives malformed JSON string', async () => {
    await expect(
      executeToolDefinition('generate_recipe', {
        dishDescription: 'test dish',
        location: 'test city',
        sensoryAnalysis: '{not valid json',
        substitutions: '{"mode":"full"}',
        sourcing: '{"ingredients":["rice"],"location":"NYC","promptForAgent":"test"}',
      }, defaultToolExecutionContext),
    ).rejects.toThrow('malformed JSON');
  });

  it('throws ToolExecutionError with invalid_json_argument code for bad JSON', async () => {
    try {
      await executeToolDefinition('generate_recipe', {
        dishDescription: 'test',
        location: 'test',
        sensoryAnalysis: 'not-json',
        substitutions: '{"mode":"full"}',
        sourcing: '{"ingredients":["rice"],"location":"NYC","promptForAgent":"test"}',
      }, defaultToolExecutionContext);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      expect((err as ToolExecutionError).code).toBe('invalid_json_argument');
    }
  });

  it('throws pipeline_guard when generate_recipe is missing required fields', async () => {
    try {
      await executeToolDefinition('generate_recipe', {
        dishDescription: 'test',
        location: 'test',
        sensoryAnalysis: null,
        substitutions: null,
        sourcing: null,
      }, defaultToolExecutionContext);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      expect((err as ToolExecutionError).code).toBe('pipeline_guard');
    }
  });
});

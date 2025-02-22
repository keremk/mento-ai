// SPDX-FileCopyrightText: 2024 LiveKit, Inc.
//
// SPDX-License-Identifier: Apache-2.0
import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  type llm,
  multimodal,
} from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../.env.local');
dotenv.config({ path: envPath });

type Config = {
  prompt: string;
  voice?: string;
};

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    console.log('waiting for participant');
    const participant = await ctx.waitForParticipant();
    console.log(`starting assistant example agent for ${participant.identity}`);

    // Get room metadata and parse instructions with safer parsing
    console.log('Room metadata:', ctx.room.metadata);
    let config: Config = { prompt: 'You are a helpful assistant.' }; // Default config
    
    try {
      if (ctx.room.metadata) {
        const roomMetadata = JSON.parse(ctx.room.metadata);
        config = {
          prompt: roomMetadata.config?.prompt || config.prompt,
          voice: roomMetadata.config?.voice
        };
      }
    } catch (e) {
      console.error('Failed to parse room metadata:', e);
    }
    
    console.log('Config:', config);

    // Create model with more careful configuration
    const modelConfig: ConstructorParameters<typeof openai.realtime.RealtimeModel>[0] = {
      instructions: config.prompt,
    };

    // Only add voice if it's specified
    if (config.voice) {
      modelConfig.voice = config.voice;
    }

    const model = new openai.realtime.RealtimeModel(modelConfig);

    const fncCtx: llm.FunctionContext = {
      weather: {
        description: 'Get the weather in a location',
        parameters: z.object({
          location: z.string().describe('The location to get the weather for'),
        }),
        execute: async ({ location }) => {
          console.debug(`executing weather function for ${location}`);
          const response = await fetch(`https://wttr.in/${location}?format=%C+%t`);
          if (!response.ok) {
            throw new Error(`Weather API returned status: ${response.status}`);
          }
          const weather = await response.text();
          return `The weather in ${location} right now is ${weather}.`;
        },
      },
    };
    const agent = new multimodal.MultimodalAgent({ model, fncCtx });
    const session = await agent
      .start(ctx.room, participant)
      .then((session) => session as openai.realtime.RealtimeSession);

    session.conversation.item.create({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Say "How can I help you today?"' }],
    });

    session.response.create();
  },
});

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
  }),
);

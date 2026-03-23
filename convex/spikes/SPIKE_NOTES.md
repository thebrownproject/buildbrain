# Agent Spike: @convex-dev/agent v0.6.x Validation

## Status: SPIKE COMPLETE

Validates that @convex-dev/agent works end-to-end in BuildBrain:
agent definition, thread creation, text generation, streaming, and frontend hooks.

## Installed Versions

| Package | Version |
|---------|---------|
| @convex-dev/agent | 0.6.1 |
| ai (AI SDK) | 6.0.134 |
| @ai-sdk/anthropic | 3.0.63 |
| @ai-sdk/openai | 3.0.47 |
| zod | 4.3.6 |
| convex-helpers | 0.1.114 |

## Files Created

| File | Purpose |
|------|---------|
| `convex/convex.config.ts` | Registers the agent component |
| `convex/spikes/agentSpike.ts` | Agent + tool definitions |
| `convex/spikes/agentSpikeActions.ts` | Thread, message, streaming mutations/actions/queries |
| `convex/spikes/SPIKE_NOTES.md` | This file (frontend hook docs) |

## Architecture: Data Flow

```
Frontend (React)
  |
  | useMutation(api.spikes.agentSpikeActions.sendSpikeMessage)
  |   --> saves user message to agent thread
  |   --> schedules streamResponse action
  |
  | useUIMessages(api.spikes.agentSpikeActions.listSpikeMessages)
  |   --> paginated UIMessages + streaming deltas
  |
  v
Convex Backend
  |
  | internalAction: streamResponse
  |   --> spikeTestAgent.continueThread(ctx, { threadId })
  |   --> thread.streamText({ promptMessageId }, { saveStreamDeltas: true })
  |   --> LLM response saved to agent thread with real-time deltas
  |
  v
AI SDK v6 + Anthropic
  |
  | claude-sonnet-4-6 (language model)
  | text-embedding-3-small (OpenAI embeddings)
```

## Frontend Hook Usage

### useUIMessages (from @convex-dev/agent/react)

The primary hook for displaying messages with real-time streaming:

```tsx
import { useUIMessages } from "@convex-dev/agent/react";
import { optimisticallySendMessage } from "@convex-dev/agent/react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

function ChatPanel({ threadId }: { threadId: string }) {
  // Fetch paginated messages + merge streaming deltas automatically.
  // useUIMessages handles:
  //   - Pagination via usePaginatedQuery
  //   - Real-time streaming via syncStreams / useStreamingUIMessages
  //   - Deduplication of messages that transition from streaming -> persisted
  const { messages, status, loadMore } = useUIMessages(
    api.spikes.agentSpikeActions.listSpikeMessages,
    { threadId },
    { stream: true, initialNumItems: 50 },
  );

  // Send a message with optimistic UI update.
  // optimisticallySendMessage adds the user message to the local cache
  // immediately, before the mutation round-trips to the server.
  const sendMessage = useMutation(
    api.spikes.agentSpikeActions.sendSpikeMessage,
  ).withOptimisticUpdate(
    optimisticallySendMessage(
      api.spikes.agentSpikeActions.listSpikeMessages,
    ),
  );

  const handleSend = (prompt: string) => {
    sendMessage({ threadId, prompt });
  };

  return (
    <div>
      {messages?.map((msg) => (
        <div key={msg.id}>
          <strong>{msg.role}:</strong>
          {msg.parts.map((part, i) => {
            if (part.type === "text") return <span key={i}>{part.text}</span>;
            if (part.type === "tool-invocation") {
              return (
                <pre key={i}>
                  Tool: {part.toolInvocation.toolName}
                  {part.toolInvocation.state === "result"
                    ? ` => ${JSON.stringify(part.toolInvocation.result)}`
                    : " (running...)"}
                </pre>
              );
            }
            return null;
          })}
        </div>
      ))}
      <button onClick={() => handleSend("Test the echo tool")}>
        Send Test
      </button>
    </div>
  );
}
```

### Alternative: useStreamingUIMessages (streaming only)

If you need just the streaming portion (e.g., a separate streaming indicator):

```tsx
import { useStreamingUIMessages } from "@convex-dev/agent/react";

// Returns only the in-flight streaming messages (not persisted ones)
const streamingMessages = useStreamingUIMessages(
  api.spikes.agentSpikeActions.listSpikeMessages,
  { threadId },
);
```

## Key API Decisions (v0.6.x)

1. **createTool uses `inputSchema` + `execute`** (not `args` + `handler` from v0.5)
2. **`createThread` is a standalone function**, not a method on Agent (in mutations).
   In actions, `Agent.createThread` returns `{ threadId, thread }`.
3. **`saveMessage` is a standalone function** for saving user messages in mutations.
4. **`agent.continueThread`** returns `{ thread }` with bound `streamText`/`generateText`.
5. **`thread.streamText`** accepts `{ saveStreamDeltas: true }` to persist deltas.
6. **`listUIMessages`** returns paginated UIMessages compatible with AI SDK UIMessage format.
7. **`syncStreams`** merges streaming deltas into the query response.
8. **`vStreamArgs`** is the Convex validator for the streaming cursor argument.
9. **Anthropic does NOT provide embeddings** -- use OpenAI's `text-embedding-3-small`.
10. **Zod v4** is installed (4.3.6) -- import from `"zod"` directly (not `"zod/v3"`).

## Migration Notes for BuildBrain V3

When migrating from the current Pi SDK agent:

- Replace `agentJobs` queue with `@convex-dev/agent`'s built-in thread/message system
- Replace `streamDeltas` table with `saveStreamDeltas: true` option
- Replace `messages.send` mutation with `saveMessage` + scheduler pattern
- Replace `messages.list` query with `listUIMessages` + `syncStreams`
- Replace custom streaming hooks with `useUIMessages` from `@convex-dev/agent/react`
- The agent component manages its own tables (threads, messages, streams, embeddings)
  so the existing `threads`, `messages`, `streamDeltas` tables become unnecessary
  for agent-managed conversations

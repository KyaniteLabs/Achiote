import { useState, useRef, useEffect } from 'react';
import { useChat } from './hooks/useChat';

const COLORS = {
  bg: '#faf7f5',
  bgDark: '#1a1210',
  achiote: '#b5451b',
  achioteLight: '#d4653a',
  text: '#2d1f16',
  textMuted: '#7a6b62',
  textDark: '#f5efe8',
  surface: '#ffffff',
  surfaceDark: '#2a201a',
  border: '#e8ddd5',
  borderDark: '#3d2f25',
} as const;

export function App() {
  const { messages, isStreaming, sendMessage } = useChat();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    sendMessage(trimmed);
    setInput('');
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Achiote</h1>
        <p style={styles.subtitle}>Recreate the dishes you remember</p>
      </header>

      <main style={styles.chatArea}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            <p style={styles.emptyTitle}>Tell me about a dish you remember</p>
            <p style={styles.emptyHint}>
              A childhood meal, a grandmother's cooking, a street food from your hometown...
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} style={msg.role === 'user' ? styles.userBubble : styles.assistantBubble}>
            <p style={msg.role === 'user' ? styles.userText : styles.assistantText}>{msg.text}</p>
          </div>
        ))}

        {isStreaming && (
          <div style={styles.assistantBubble}>
            <p style={styles.assistantText}>
              <span style={styles.cursor} />
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <form style={styles.inputBar} onSubmit={handleSubmit}>
        <input
          style={styles.input}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe a dish from your memory..."
          disabled={isStreaming}
          aria-label="Food memory input"
        />
        <button
          style={{ ...styles.sendBtn, opacity: isStreaming ? 0.5 : 1 }}
          type="submit"
          disabled={isStreaming}
          aria-label="Send"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    maxWidth: 600,
    margin: '0 auto',
    background: COLORS.bg,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: COLORS.text,
  },
  header: {
    padding: '16px 20px',
    borderBottom: `1px solid ${COLORS.border}`,
    textAlign: 'center' as const,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: COLORS.achiote,
    margin: 0,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    margin: '4px 0 0',
  },
  chatArea: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px 16px 8px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    textAlign: 'center' as const,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: COLORS.text,
    margin: '0 0 8px',
  },
  emptyHint: {
    fontSize: 14,
    color: COLORS.textMuted,
    margin: 0,
    lineHeight: 1.5,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    background: COLORS.achiote,
    borderRadius: '18px 18px 4px 18px',
    padding: '10px 14px',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '18px 18px 18px 4px',
    padding: '10px 14px',
  },
  userText: {
    fontSize: 15,
    lineHeight: 1.5,
    color: '#fff',
    margin: 0,
    whiteSpace: 'pre-wrap' as const,
  },
  assistantText: {
    fontSize: 15,
    lineHeight: 1.5,
    color: COLORS.text,
    margin: 0,
    whiteSpace: 'pre-wrap' as const,
  },
  cursor: {
    display: 'inline-block',
    width: 8,
    height: 16,
    background: COLORS.textMuted,
    borderRadius: 1,
    animation: 'blink 1s step-end infinite',
  },
  inputBar: {
    display: 'flex',
    gap: 8,
    padding: '12px 16px',
    borderTop: `1px solid ${COLORS.border}`,
    background: COLORS.bg,
  },
  input: {
    flex: 1,
    fontSize: 16,
    padding: '10px 14px',
    borderRadius: 24,
    border: `1px solid ${COLORS.border}`,
    outline: 'none',
    background: COLORS.surface,
    color: COLORS.text,
    minHeight: 44,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: 'none',
    background: COLORS.achiote,
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
};

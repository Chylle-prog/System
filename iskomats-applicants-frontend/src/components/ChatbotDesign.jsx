import React, { useMemo, useState, useEffect, useRef } from 'react';

function ChatbotDesign({
  apiUrl = 'http://localhost:8000',
  botName = 'IskoBots AI',
  primaryColor = '#4F0D00',
  suggestions = [
    { id: 'a', label: 'What scholarships are available?', text: 'What scholarships are available?' },
    { id: 'b', label: 'How do I apply?', text: 'How do I apply for a scholarship?' },
    { id: 'c', label: 'What are the requirements?', text: 'What are the requirements to apply?' },
  ],
  position = 'bottom-right',
  zIndex = 99999,
  userName: defaultUserName = '',
}) {
  const [inputValue, setInputValue] = useState('');
  const [userName] = useState(() => localStorage.getItem('iskobots_userName') || defaultUserName);
  const [sessionHistory, setSessionHistory] = useState(() => {
    const name = localStorage.getItem('iskobots_userName') || defaultUserName || 'Scholar';
    return [
      {
        id: 1,
        title: 'Welcome session',
        preview: `${botName} introduction.`,
        messages: [
          { id: 1, sender: 'bot', text: `Hi there 👋 Welcome, ${name}! I am ${botName}, your ISKOMATS AI assistant.`, timestamp: '' },
          { id: 2, sender: 'bot', text: 'How can I help you with your scholarship application today?', timestamp: '' },
        ],
        date: 'Today',
      },
    ];
  });
  const [activeSession, setActiveSession] = useState(1);
  const [isOpen, setIsOpen] = useState(false);
  const [animateShow, setAnimateShow] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [backendStatus, setBackendStatus] = useState('checking');

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const posStyle = useMemo(() => {
    if (position === 'bottom-left') return { left: '24px', right: 'auto', bottom: '24px' };
    return { right: '24px', left: 'auto', bottom: '24px' };
  }, [position]);

  const messages = useMemo(() => {
    const active = sessionHistory.find((s) => s.id === activeSession);
    return active ? active.messages : [];
  }, [sessionHistory, activeSession]);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => setAnimateShow(true), 20);
      return () => clearTimeout(t);
    } else {
      setAnimateShow(false);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, isTyping, streamingText]);

  useEffect(() => {
    if (isOpen && animateShow) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, animateShow]);

  useEffect(() => {
    fetch(`${apiUrl}/health`)
      .then(r => r.json())
      .then(data => setBackendStatus(data.status === 'ok' || data.status === 'healthy' ? 'connected' : 'degraded'))
      .catch(() => setBackendStatus('connected')); // Fallback to online UI state
  }, [apiUrl]);

  const handleOpen = () => {
    setIsOpen(true);
    setShowHistory(false);
  };

  const handleClose = () => {
    setAnimateShow(false);
    setTimeout(() => {
      setIsOpen(false);
      setShowHistory(false);
    }, 250);
  };

  const handleNewChat = () => {
    const newId = Date.now();
    const displayName = userName || 'Scholar';
    const newSession = {
      id: newId,
      title: 'New Chat',
      preview: 'No messages yet.',
      messages: [
        { id: 1, sender: 'bot', text: `Hi 👋 Welcome back, ${displayName}!`, timestamp: '' },
        { id: 2, sender: 'bot', text: 'How can I assist you with your scholarship today?', timestamp: '' },
      ],
      date: 'Today',
    };
    setSessionHistory((cur) => [newSession, ...cur]);
    setActiveSession(newId);
    setInputValue('');
    setShowHistory(false);
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const text = inputValue.trim();
    if (!text || isTyping) return;

    const userMsgId = Date.now();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setSessionHistory((prev) =>
      prev.map((s) => {
        if (s.id === activeSession) {
          return {
            ...s,
            preview: text.slice(0, 30),
            messages: [...s.messages, { id: userMsgId, sender: 'user', text, timestamp: timeStr }],
          };
        }
        return s;
      })
    );

    setInputValue('');
    setIsTyping(true);
    setStreamingText('');

    try {
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, user_name: userName || 'Scholar' }),
      });

      if (response.ok) {
        const data = await response.json();
        const replyText = data.reply || data.response || data.message || "I'm here to help with your scholarship applications!";
        
        setSessionHistory((prev) =>
          prev.map((s) => {
            if (s.id === activeSession) {
              return {
                ...s,
                messages: [
                  ...s.messages,
                  { id: Date.now(), sender: 'bot', text: replyText, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
                ],
              };
            }
            return s;
          })
        );
      } else {
        throw new Error('Server response error');
      }
    } catch {
      // Local intelligent fallback response
      let fallbackText = "I can assist you with scholarship guidelines, document uploads, grade requirements, and application status tracking!";
      const lower = text.toLowerCase();

      if (lower.includes('requirement') || lower.includes('document')) {
        fallbackText = "Requirements usually include your Certificate of Indigency, Certificate of Enrollment (COE), latest Grades / Transcript of Records, and a valid School ID.";
      } else if (lower.includes('gpa') || lower.includes('grade')) {
        fallbackText = "Scholarships require maintaining a minimum GPA (typically 80% or 3.0+ equivalent) without failing grades.";
      } else if (lower.includes('apply') || lower.includes('how')) {
        fallbackText = "You can apply by navigating to 'Find Scholarship', selecting a scholarship that matches your course and barangay, and filling out the application wizard!";
      }

      setSessionHistory((prev) =>
        prev.map((s) => {
          if (s.id === activeSession) {
            return {
              ...s,
              messages: [
                ...s.messages,
                { id: Date.now(), sender: 'bot', text: fallbackText, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
              ],
            };
          }
          return s;
        })
      );
    } finally {
      setIsTyping(false);
      setStreamingText('');
    }
  };

  return (
    <div style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif", fontSize: '14px' }}>
      <style>{`
        .iskobots-pulse-btn {
          animation: iskobotsPulse 2s infinite;
        }
        @keyframes iskobotsPulse {
          0% { box-shadow: 0 0 0 0 rgba(79, 13, 0, 0.5); }
          70% { box-shadow: 0 0 0 14px rgba(79, 13, 0, 0); }
          100% { box-shadow: 0 0 0 0 rgba(79, 13, 0, 0); }
        }
      `}</style>

      {/* ── Floating Trigger Button ── */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          type="button"
          className="iskobots-pulse-btn"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            width: '58px',
            height: '58px',
            borderRadius: '50%',
            backgroundColor: primaryColor,
            color: '#ffffff',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: zIndex,
            boxShadow: '0 8px 24px rgba(79, 13, 0, 0.4)',
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            ...posStyle,
          }}
          aria-label={`Open ${botName} chat`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ width: '26px', height: '26px' }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
      )}

      {/* ── Chat Modal Window ── */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            width: '360px',
            maxWidth: 'calc(100vw - 32px)',
            height: '520px',
            maxHeight: 'calc(100vh - 80px)',
            backgroundColor: '#ffffff',
            borderRadius: '20px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.25)',
            zIndex: zIndex,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            border: '1px solid rgba(0, 0, 0, 0.08)',
            opacity: animateShow ? 1 : 0,
            transform: animateShow ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.96)',
            transition: 'opacity 250ms ease-out, transform 250ms ease-out',
            ...posStyle,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: primaryColor,
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" style={{ width: '18px', height: '18px' }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: '800', fontSize: '0.92rem', color: '#ffffff', lineHeight: 1.2 }}>{botName}</p>
                <p style={{ margin: 0, fontSize: '0.7rem', color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80' }}></span>
                  Online Assistant
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                onClick={handleNewChat}
                style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '8px', padding: '4px 8px', fontSize: '0.72rem', fontWeight: '700', cursor: 'pointer' }}
              >
                + New Chat
              </button>
              <button
                type="button"
                onClick={handleClose}
                style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', background: '#f8fafc' }}>
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';
              return (
                <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: '3px' }}>
                  <div
                    style={{
                      maxWidth: '82%',
                      padding: '10px 14px',
                      fontSize: '0.86rem',
                      lineHeight: '1.45',
                      whiteSpace: 'pre-wrap',
                      borderRadius: isUser ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                      backgroundColor: isUser ? primaryColor : '#ffffff',
                      color: isUser ? '#ffffff' : '#1e293b',
                      boxShadow: isUser ? 'none' : '0 2px 8px rgba(0,0,0,0.05)',
                      border: isUser ? 'none' : '1px solid #f1f5f9',
                    }}
                  >
                    {msg.text}
                  </div>
                  {msg.timestamp && (
                    <span style={{ fontSize: '0.65rem', color: '#94a3b8', padding: '0 4px' }}>{msg.timestamp}</span>
                  )}
                </div>
              );
            })}

            {isTyping && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: '#ffffff', borderRadius: '12px', width: 'fit-content', border: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '600' }}>IskoBots is typing...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          <div style={{ padding: '8px 12px', background: '#ffffff', borderTop: '1px solid #f1f5f9', display: 'flex', gap: '6px', overflowX: 'auto' }}>
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setInputValue(s.text)}
                style={{
                  whiteSpace: 'nowrap',
                  padding: '5px 10px',
                  borderRadius: '12px',
                  background: '#f1f5f9',
                  border: 'none',
                  fontSize: '0.72rem',
                  color: '#475569',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Input Box */}
          <form onSubmit={handleSend} style={{ padding: '12px', background: '#ffffff', borderTop: '1px solid #f1f5f9', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask IskoBots about scholarships..."
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '24px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                outline: 'none',
                background: '#f8fafc',
                color: '#0f172a',
              }}
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isTyping}
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                backgroundColor: primaryColor,
                color: '#ffffff',
                border: 'none',
                cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
                opacity: inputValue.trim() ? 1 : 0.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: '16px', height: '16px' }}>
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default ChatbotDesign;

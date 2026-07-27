import { useMemo, useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

function ChatbotDesign({
  apiUrl = import.meta.env.VITE_CHATBOT_API_URL || import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:8000',
  botName = 'IskoBots',
  primaryColor = '#4F0D00',
  suggestions = [
    { id: 'a', label: 'What scholarships are available?', text: 'What scholarships are available?' },
    { id: 'b', label: 'How do I apply?', text: 'How do I apply for a scholarship?' },
    { id: 'c', label: 'What are the requirements?', text: 'What are the requirements to apply?' },
  ],
  position = 'bottom-right',
  zIndex = 999999,
  userName: defaultUserName = '',
}) {
  const [inputValue, setInputValue] = useState('')
  const [userName, _setUserName] = useState(() => localStorage.getItem('iskobots_userName') || defaultUserName)
  const [sessionHistory, setSessionHistory] = useState(() => {
    const name = localStorage.getItem('iskobots_userName') || defaultUserName || 'scholar'
    return [
      {
        id: 1,
        title: 'Welcome session',
        preview: `${botName} introduction.`,
        messages: [
          { id: 1, sender: 'bot', text: `Hi there 👋 Welcome, ${name}!`, timestamp: '' },
          { id: 2, sender: 'bot', text: 'How can I help you today?', timestamp: '' },
        ],
        date: 'Today',
      },
    ]
  })
  const [activeSession, setActiveSession] = useState(1)
  const [isOpen, setIsOpen] = useState(false)
  const [animateShow, setAnimateShow] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [streamingText, setStreamingText] = useState('')
  const [backendStatus, setBackendStatus] = useState('checking')
  const [viewportHeight, setViewportHeight] = useState(null)

  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const streamingTextRef = useRef('')

  // Mobile virtual keyboard height handling
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const handleResize = () => {
      if (window.innerWidth <= 640 && isOpen) {
        setViewportHeight(window.visualViewport.height);
      } else {
        setViewportHeight(null);
      }
    };

    window.visualViewport.addEventListener('resize', handleResize);
    window.visualViewport.addEventListener('scroll', handleResize);
    handleResize();

    return () => {
      window.visualViewport.removeEventListener('resize', handleResize);
      window.visualViewport.removeEventListener('scroll', handleResize);
    };
  }, [isOpen]);

  const posStyle = useMemo(() => {
    if (position === 'bottom-left') return { left: '24px', right: 'auto', bottom: '24px' }
    return { right: '24px', left: 'auto', bottom: '24px' }
  }, [position])

  const messages = useMemo(() => {
    const active = sessionHistory.find((s) => s.id === activeSession)
    return active ? active.messages : []
  }, [sessionHistory, activeSession])

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => setAnimateShow(true), 20)
      return () => clearTimeout(t)
    } else {
      setAnimateShow(false)
    }
  }, [isOpen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, isTyping, streamingText])

  useEffect(() => {
    if (isOpen && animateShow) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, animateShow])

  useEffect(() => {
    const safeUrl = typeof apiUrl === 'string' && apiUrl ? apiUrl : 'http://localhost:8000';
    const cleanUrl = safeUrl.endsWith('/') ? safeUrl.slice(0, -1) : safeUrl;
    fetch(`${cleanUrl}/api/health`)
      .then(r => r.json())
      .then(data => setBackendStatus(data.status === 'ok' ? 'connected' : 'degraded'))
      .catch(() => setBackendStatus('connected'))
  }, [apiUrl])

  const handleOpen = () => {
    setIsOpen(true)
    setShowHistory(false)
  }

  const handleClose = () => {
    setAnimateShow(false)
    setTimeout(() => {
      setIsOpen(false)
      setShowHistory(false)
    }, 250)
  }

  const handleNewChat = () => {
    const newId = Date.now()
    const displayName = userName || 'scholar'
    const newSession = {
      id: newId,
      title: 'New Chat',
      preview: 'No messages yet.',
      messages: [
        { id: 1, sender: 'bot', text: `Hi there 👋 Welcome, ${displayName}!`, timestamp: '' },
        { id: 2, sender: 'bot', text: 'How can I help you today?', timestamp: '' },
      ],
      date: 'Today',
    }
    setSessionHistory((cur) => [newSession, ...cur])
    setActiveSession(newId)
    setInputValue('')
    setShowHistory(false)
  }

  const handleSessionClick = (id) => {
    setActiveSession(id)
    setInputValue('')
    setShowHistory(false)
  }

  const handleDeleteRequest = (e, session) => {
    e.stopPropagation()
    setDeleteConfirm(session)
  }

  const handleDeleteConfirmed = () => {
    if (!deleteConfirm) return
    const idToDelete = deleteConfirm.id
    const remaining = sessionHistory.filter((s) => s.id !== idToDelete)
    setDeleteConfirm(null)

    if (remaining.length === 0) {
      const displayName = userName || 'scholar'
      const freshId = Date.now()
      const freshSession = {
        id: freshId,
        title: 'Welcome session',
        preview: `${botName} introduction.`,
        messages: [
          { id: 1, sender: 'bot', text: `Hi there 👋 Welcome, ${displayName}!`, timestamp: '' },
          { id: 2, sender: 'bot', text: 'How can I help you today?', timestamp: '' },
        ],
        date: 'Today',
      }
      setSessionHistory([freshSession])
      setActiveSession(freshId)
    } else {
      setSessionHistory(remaining)
      if (activeSession === idToDelete) {
        setActiveSession(remaining[0].id)
      }
    }
    setShowHistory(false)
  }

  const handleSend = async (e) => {
    if (e) e.preventDefault()
    const text = inputValue.trim()
    if (!text || isTyping) return

    const userMsgId = Date.now()
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    setSessionHistory((prev) =>
      prev.map((s) => {
        if (s.id === activeSession) {
          const isFirstUserMsg = !s.messages.some((m) => m.sender === 'user')
          return {
            ...s,
            title: isFirstUserMsg ? text.slice(0, 24) + (text.length > 24 ? '…' : '') : s.title,
            preview: text.slice(0, 32) + (text.length > 32 ? '…' : ''),
            messages: [...s.messages, { id: userMsgId, sender: 'user', text, timestamp: timeStr }],
          }
        }
        return s;
      }),
    )

    setInputValue('')
    setIsTyping(true)
    setStreamingText('')
    streamingTextRef.current = ''

    const currentActiveId = activeSession
    const safeUrl = typeof apiUrl === 'string' && apiUrl ? apiUrl : 'http://localhost:8000';
    const cleanUrl = safeUrl.endsWith('/') ? safeUrl.slice(0, -1) : safeUrl;

    try {
      abortRef.current = new AbortController()
      const response = await fetch(`${cleanUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, user_name: userName || 'scholar' }),
        signal: abortRef.current.signal,
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })

        if (chunk.includes('data:')) {
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const payload = line.slice(5).trim()
              if (payload === '[DONE]') continue
              try {
                const parsed = JSON.parse(payload)
                if (parsed.text) {
                  streamingTextRef.current += parsed.text
                  setStreamingText(streamingTextRef.current)
                }
              } catch {
                streamingTextRef.current += payload
                setStreamingText(streamingTextRef.current)
              }
            }
          }
        } else {
          try {
            const parsed = JSON.parse(chunk)
            streamingTextRef.current = parsed.reply || parsed.response || parsed.message || chunk
          } catch {
            streamingTextRef.current += chunk
          }
          setStreamingText(streamingTextRef.current)
        }
      }

      const finalReply = streamingTextRef.current.trim() || 'No response received.'
      const botMsgId = Date.now() + 1
      const botTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

      setSessionHistory((prev) =>
        prev.map((s) => {
          if (s.id === currentActiveId) {
            return {
              ...s,
              messages: [...s.messages, { id: botMsgId, sender: 'bot', text: finalReply, timestamp: botTimeStr }],
            }
          }
          return s
        }),
      )
    } catch (err) {
      if (err.name === 'AbortError') return

      let fallbackText = "I can assist you with scholarship guidelines, document uploads, grade requirements, and application status tracking!"
      const lower = text.toLowerCase();
      if (lower.includes('requirement') || lower.includes('document')) {
        fallbackText = "Requirements usually include your Certificate of Indigency, Certificate of Enrollment (COE), latest Grades / Transcript of Records, and a valid School ID.";
      } else if (lower.includes('gpa') || lower.includes('grade')) {
        fallbackText = "Scholarships require maintaining a minimum GPA (typically 80% or 3.0+ equivalent) without failing grades.";
      } else if (lower.includes('apply') || lower.includes('how')) {
        fallbackText = "You can apply by navigating to 'Find Scholarship', selecting a scholarship that matches your course and barangay, and filling out the application wizard!";
      }

      const botMsgId = Date.now() + 1
      const botTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      setSessionHistory((prev) =>
        prev.map((s) => {
          if (s.id === currentActiveId) {
            return {
              ...s,
              messages: [...s.messages, { id: botMsgId, sender: 'bot', text: fallbackText, timestamp: botTimeStr }],
            }
          }
          return s
        }),
      )
    } finally {
      setIsTyping(false)
      setStreamingText('')
      streamingTextRef.current = ''
      abortRef.current = null
    }
  }

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
  }

  const handleSuggestion = (text) => {
    setInputValue(text)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return sessionHistory
    const q = searchQuery.toLowerCase()
    return sessionHistory.filter(
      (s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q),
    )
  }, [sessionHistory, searchQuery])

  const renderedMessages = useMemo(
    () => {
      const msgs = messages.map((msg) => {
        const isUser = msg.sender === 'user'
        return (
          <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} gap-0.5`}>
            <div
              className={`max-w-[75%] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                isUser
                  ? 'text-white rounded-2xl rounded-br-sm'
                  : 'bg-white text-gray-700 rounded-2xl rounded-bl-sm shadow-sm border border-gray-100'
              }`}
              style={isUser ? { backgroundColor: primaryColor } : undefined}
            >
              {msg.text}
            </div>
            {msg.timestamp && (
              <span className="text-[10px] text-gray-400 px-1">{msg.timestamp}</span>
            )}
          </div>
        )
      })

      if (streamingText) {
        msgs.push(
          <div key="streaming" className="flex flex-col items-start gap-0.5">
            <div className="max-w-[75%] px-4 py-2.5 text-sm leading-relaxed bg-white text-gray-700 rounded-2xl rounded-bl-sm shadow-sm border border-gray-100 whitespace-pre-wrap">
              {streamingText}
              <span className="inline-block w-0.5 h-4 bg-gray-400 ml-0.5 animate-pulse" />
            </div>
          </div>
        )
      }

      return msgs
    },
    [messages, streamingText, primaryColor],
  )

  const content = (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '14px', lineHeight: '1.5', color: '#374151' }}>
      <style>{`
        .iskobots-design-root *, .iskobots-design-root *::before, .iskobots-design-root *::after { box-sizing: border-box; }
        @keyframes animate-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-100%); } }
        @keyframes animate-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .flex { display: flex; }
        .flex-col { flex-direction: column; }
        .flex-1 { flex: 1 1 0%; }
        .flex-row { flex-direction: row; }
        .items-start { align-items: flex-start; }
        .items-end { align-items: flex-end; }
        .items-center { align-items: center; }
        .justify-center { justify-content: center; }
        .justify-start { justify-content: flex-start; }
        .shrink-0 { flex-shrink: 0; }
        .gap-0\.5 { gap: 0.125rem; }
        .gap-1 { gap: 0.25rem; }
        .gap-1\.5 { gap: 0.375rem; }
        .gap-2 { gap: 0.5rem; }
        .gap-2\.5 { gap: 0.625rem; }
        .gap-3 { gap: 0.75rem; }
        .fixed { position: fixed !important; }
        .absolute { position: absolute !important; }
        .relative { position: relative !important; }
        .inset-0 { top: 0; right: 0; bottom: 0; left: 0; }
        .w-1\.5 { width: 0.375rem; }
        .h-1\.5 { height: 0.375rem; }
        .w-3\.5 { width: 0.875rem; }
        .h-3\.5 { height: 0.875rem; }
        .w-4 { width: 1rem; }
        .h-4 { height: 1rem; }
        .w-6 { width: 1.5rem; }
        .h-6 { height: 1.5rem; }
        .w-8 { width: 2rem; }
        .h-8 { height: 2rem; }
        .w-9 { width: 2.25rem; }
        .h-9 { height: 2.25rem; }
        .w-12 { width: 3rem !important; }
        .h-12 { height: 3rem !important; }
        .w-full { width: 100%; }
        .h-full { height: 100%; }
        .w-px { width: 1px; }
        .max-w-\[280px\] { max-width: 280px; }
        .max-w-\[75%\] { max-width: 75%; }
        .max-w-\[calc\(100vw-32px\)\] { max-width: calc(100vw - 32px); }
        .max-h-\[calc\(100vh-80px\)\] { max-height: calc(100vh - 80px); }
        .w-\[320px\] { width: 320px; }
        .h-\[440px\] { height: 440px; }
        .p-1\.5 { padding: 0.375rem; }
        .p-3 { padding: 0.75rem; }
        .p-4 { padding: 1rem; }
        .p-5 { padding: 1.25rem; }
        .px-1 { padding-left: 0.25rem; padding-right: 0.25rem; }
        .px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
        .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
        .px-4 { padding-left: 1rem; padding-right: 1rem; }
        .px-8 { padding-left: 2rem; padding-right: 2rem; }
        .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
        .py-2\.5 { padding-top: 0.625rem; padding-bottom: 0.625rem; }
        .py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
        .py-4 { padding-top: 1rem; padding-bottom: 1rem; }
        .py-12 { padding-top: 3rem; padding-bottom: 3rem; }
        .pl-8 { padding-left: 2rem; }
        .pl-3\.5 { padding-left: 0.875rem; }
        .pr-4 { padding-right: 1rem; }
        .mb-0\.5 { margin-bottom: 0.125rem; }
        .mt-1 { margin-top: 0.25rem; }
        .mx-1 { margin-left: 0.25rem; margin-right: 0.25rem; }
        .m-0 { margin: 0; }
        .text-left { text-align: left; }
        .text-center { text-align: center; }
        .text-xs { font-size: 0.75rem; line-height: 1rem; }
        .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
        .text-\[10px\] { font-size: 10px; }
        .text-\[11px\] { font-size: 11px; }
        .font-semibold { font-weight: 600; }
        .font-bold { font-weight: 700; }
        .font-medium { font-weight: 500; }
        .leading-tight { line-height: 1.25; }
        .leading-relaxed { line-height: 1.625; }
        .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .whitespace-pre-wrap { white-space: pre-wrap; word-wrap: break-word; }
        .rounded-full { border-radius: 9999px !important; }
        .rounded-2xl { border-radius: 1rem; }
        .rounded-xl { border-radius: 0.75rem; }
        .rounded-bl-sm { border-bottom-left-radius: 0.25rem; }
        .rounded-br-sm { border-bottom-right-radius: 0.25rem; }
        .border { border-width: 1px; border-style: solid; }
        .border-none { border: none; }
        .border-t { border-top-width: 1px; border-top-style: solid; }
        .border-b { border-bottom-width: 1px; border-bottom-style: solid; }
        .border-r { border-right-width: 1px; border-right-style: solid; }
        .border-gray-100 { border-color: #f3f4f6; }
        .border-gray-200 { border-color: #e5e7eb; }
        .border-transparent { border-color: transparent; }
        .bg-white { background-color: #fff; }
        .bg-gray-100 { background-color: #f3f4f6; }
        .bg-gray-50 { background-color: #f9fafb; }
        .bg-gray-200 { background-color: #e5e7eb; }
        .bg-black\/40 { background-color: rgba(0,0,0,0.4); }
        .bg-rose-50 { background-color: #fff1f2; }
        .bg-rose-100 { background-color: #ffe4e6; }
        .bg-white\/20 { background-color: rgba(255,255,255,0.2); }
        .text-white { color: #fff; }
        .text-gray-300 { color: #d1d5db; }
        .text-gray-400 { color: #9ca3af; }
        .text-gray-500 { color: #6b7280; }
        .text-gray-600 { color: #4b5563; }
        .text-gray-700 { color: #374151; }
        .text-gray-800 { color: #1f2937; }
        .text-rose-500 { color: #f43f5e; }
        .text-rose-600 { color: #e11d48; }
        .text-emerald-400 { color: #34d399; }
        .text-yellow-400 { color: #facc15; }
        .text-red-400 { color: #f87171; }
        .text-white\/70 { color: rgba(255,255,255,0.7); }
        .shadow-sm { box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); }
        .shadow-xl { box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1); }
        .backdrop-blur-sm { backdrop-filter: blur(4px); }
        .overflow-hidden { overflow: hidden; }
        .overflow-y-auto { overflow-y: auto; }
        .outline-none { outline: none; }
        .pointer-events-none { pointer-events: none; }
        .cursor-pointer { cursor: pointer; }
        .transition-all { transition-property: all; transition-timing-function: cubic-bezier(0.4,0,0.2,1); transition-duration: 150ms; }
        .transition-colors { transition-property: color, background-color, border-color; transition-timing-function: cubic-bezier(0.4,0,0.2,1); transition-duration: 150ms; }
        .duration-150 { transition-duration: 150ms; }
        .duration-200 { transition-duration: 200ms; }
        .duration-300 { transition-duration: 300ms; }
        .translate-y-0 { transform: translateY(0); }
        .-translate-y-1\/2 { transform: translateY(-50%); }
        .scale-1 { transform: scale(1); }
        .scale-95 { transform: scale(0.95); }
        .hover\:scale-105:hover { transform: scale(1.05); }
        .hover\:shadow-md:hover { box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1); }
        .hover\:bg-gray-50:hover { background-color: #f9fafb; }
        .hover\:bg-gray-200:hover { background-color: #e5e7eb; }
        .hover\:text-white:hover { color: #fff; }
        .hover\:text-gray-700:hover { color: #374151; }
        .hover\:text-rose-500:hover { color: #f43f5e; }
        .hover\:bg-white\/10:hover { background-color: rgba(255,255,255,0.1); }
        .hover\:bg-rose-50:hover { background-color: #fff1f2; }
        .active\:scale-95:active { transform: scale(0.95); }
        .disabled\:opacity-40:disabled { opacity: 0.4; }
        .disabled\:cursor-not-allowed:disabled { cursor: not-allowed; }
        .disabled\:hover\:shadow-none:disabled:hover { box-shadow: none; }
        .opacity-0 { opacity: 0; }
        .group\/item:hover .group-hover\/item\:opacity-100 { opacity: 1; }
        .z-20 { z-index: 20; }
        .z-30 { z-index: 30; }
        .grid { display: grid; }
        .place-items-center { place-items: center; }
        .animate-bounce { animation: animate-bounce 1s infinite; }
        .animate-pulse { animation: animate-pulse 2s cubic-bezier(0.4,0,0.6,1) infinite; }
        .inline-block { display: inline-block; }

        /* Mobile Keyboard Responsiveness */
        @media (max-width: 640px) {
          .iskobots-mobile-widget {
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            top: auto !important;
            width: 100vw !important;
            max-width: 100vw !important;
            border-radius: 20px 20px 0 0 !important;
          }
          .iskobots-mobile-trigger {
            bottom: 16px !important;
            right: 16px !important;
          }
        }
      `}</style>

      <div className="iskobots-design-root">
        {/* ── Floating Trigger ── */}
        {!isOpen && (
          <button
            onClick={handleOpen}
            type="button"
            className="iskobots-mobile-trigger"
            style={{
              position: 'fixed',
              bottom: '24px',
              right: '24px',
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: primaryColor,
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 8px 28px ${primaryColor}66`,
              zIndex: zIndex,
              transition: 'transform 0.25s ease, box-shadow 0.25s ease',
              ...posStyle,
            }}
            aria-label={`Open ${botName} chat`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: '26px', height: '26px' }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>
        )}

        {/* ── Chat Widget ── */}
        {isOpen && (
          <div
            className="iskobots-mobile-widget"
            style={{
              position: 'fixed',
              bottom: '24px',
              right: '24px',
              width: '360px',
              maxWidth: 'calc(100vw - 32px)',
              height: '500px',
              maxHeight: 'calc(100vh - 80px)',
              backgroundColor: '#ffffff',
              borderRadius: '20px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
              zIndex: zIndex,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              border: '1px solid rgba(0,0,0,0.08)',
              opacity: animateShow ? 1 : 0,
              transform: animateShow ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.96)',
              transition: 'opacity 250ms ease-out, transform 250ms ease-out',
              ...(viewportHeight ? { height: `${viewportHeight}px`, maxHeight: `${viewportHeight}px`, bottom: 0 } : {}),
              ...posStyle,
            }}
          >
            {/* ── Header ── */}
            <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ backgroundColor: primaryColor, color: '#fff' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-white/20 grid place-items-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="w-4 h-4">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <div>
                  <p className="m-0 text-white font-bold text-sm leading-tight">{botName}</p>
                  <p className="m-0 text-white/70 text-[10px] flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full animate-pulse inline-block ${
                      backendStatus === 'connected' ? 'bg-emerald-400' :
                      backendStatus === 'degraded' ? 'bg-yellow-400' : 'bg-red-400'
                    }`} />
                    {backendStatus === 'connected' ? 'Online' :
                     backendStatus === 'degraded' ? 'Degraded' : 'Offline'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowHistory((v) => !v)}
                  className="w-7 h-7 rounded-full text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors border-none cursor-pointer"
                  title="Chat history"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="w-7 h-7 rounded-full text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors border-none cursor-pointer"
                  title="New chat"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="w-7 h-7 rounded-full text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors border-none cursor-pointer ml-1"
                  title="Close chat"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            </div>

            {/* ── History Panel ── */}
            {showHistory && (
              <div className="absolute inset-0 z-20 bg-white flex flex-col pt-[52px]">
                <div className="px-3 py-2 border-b border-gray-100">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search history..."
                    className="w-full px-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none"
                  />
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {filteredHistory.length === 0 ? (
                    <p className="text-center text-xs text-gray-400 py-8">No chats found.</p>
                  ) : (
                    filteredHistory.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => handleSessionClick(s.id)}
                        className={`group/item flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-colors ${
                          s.id === activeSession ? 'bg-gray-100 font-semibold' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="truncate flex-1 pr-2">
                          <p className="m-0 text-xs text-gray-800 truncate">{s.title}</p>
                          <p className="m-0 text-[10px] text-gray-400 truncate">{s.preview}</p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteRequest(e, s)}
                          className="opacity-0 group-hover/item:opacity-100 p-1 text-gray-400 hover:text-rose-500 rounded border-none cursor-pointer transition-opacity"
                          title="Delete session"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                          </svg>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ── Messages List ── */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-gray-50/50">
              {renderedMessages}
              {isTyping && !streamingText && (
                <div className="flex items-center gap-1.5 text-gray-400 text-xs py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* ── Suggestions ── */}
            {suggestions.length > 0 && messages.length <= 2 && (
              <div className="px-3 py-2 border-t border-gray-100 flex gap-1.5 overflow-x-auto bg-white shrink-0">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSuggestion(s.text)}
                    className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-full border-none cursor-pointer transition-colors shrink-0"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {/* ── Input Form ── */}
            <form onSubmit={handleSend} className="p-3 border-t border-gray-100 flex items-center gap-2 bg-white shrink-0">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask IskoBots..."
                style={{
                  flex: 1,
                  padding: '8px 16px',
                  fontSize: '14px',
                  backgroundColor: '#f3f4f6',
                  borderRadius: '9999px',
                  border: 'none',
                  outline: 'none',
                  color: '#1f2937',
                }}
              />
              {isTyping ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="w-9 h-9 shrink-0 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center cursor-pointer hover:bg-gray-300 transition-colors border-none"
                  title="Stop generating"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  className="w-9 h-9 shrink-0 rounded-full text-white border-none cursor-pointer flex items-center justify-center transition-all duration-200 hover:shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
                  style={{ backgroundColor: primaryColor }}
                  disabled={!inputValue.trim()}
                  title="Send"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              )}
            </form>

            {/* ── Delete Confirmation ── */}
            {deleteConfirm && (
              <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-[280px] overflow-hidden">
                  <div className="p-5 text-left">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 rounded-full bg-rose-100 grid place-items-center shrink-0">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#e11d48" strokeWidth="2" className="w-4 h-4">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                        </svg>
                      </div>
                      <p className="m-0 text-sm font-bold text-gray-800">Delete chat?</p>
                    </div>
                    <p className="m-0 text-xs text-gray-500 leading-relaxed">
                      "<span className="font-semibold text-gray-700">{deleteConfirm.title}</span>" will be permanently removed. This cannot be undone.
                    </p>
                  </div>
                  <div className="flex border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(null)}
                      className="flex-1 py-3 text-sm text-gray-600 font-semibold border-none cursor-pointer hover:bg-gray-50 transition-colors bg-transparent border-r border-gray-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteConfirmed}
                      className="flex-1 py-3 text-sm text-rose-600 font-bold border-none cursor-pointer hover:bg-rose-50 transition-colors bg-transparent"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}

export default ChatbotDesign

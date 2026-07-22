import { useMemo, useState, useEffect, useRef, useCallback } from 'react'

function ChatbotDesign({
  apiUrl = 'http://localhost:8000',
  botName = 'IskoBots',
  primaryColor = '#800000',
  suggestions = [
    { id: 'a', label: 'What scholarships are available?', text: 'What scholarships are available?' },
    { id: 'b', label: 'How do I apply?', text: 'How do I apply for a scholarship?' },
    { id: 'c', label: 'What are the requirements?', text: 'What are the requirements to apply?' },
  ],
  position = 'bottom-right',
  zIndex = 999,
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
          { id: 1, sender: 'bot', text: `Hi there \u{1F44B} Welcome, ${name}!`, timestamp: '' },
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

  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const streamingTextRef = useRef('')

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
  }, [messages, isTyping])

  useEffect(() => {
    if (isOpen && animateShow) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, animateShow])

  useEffect(() => {
    fetch(`${apiUrl}/api/health`)
      .then(r => r.json())
      .then(data => setBackendStatus(data.status === 'ok' ? 'connected' : 'degraded'))
      .catch(() => setBackendStatus('disconnected'))
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
        { id: 1, sender: 'bot', text: `Hi there \u{1F44B} Welcome, ${displayName}!`, timestamp: '' },
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

  const handleDeleteClick = (e, session) => {
    e.stopPropagation()
    setDeleteConfirm({ sessionId: session.id, title: session.title })
  }

  const handleDeleteConfirmed = () => {
    const id = deleteConfirm.sessionId
    const remaining = sessionHistory.filter((s) => s.id !== id)
    setSessionHistory(remaining)
    if (activeSession === id) {
      if (remaining.length > 0) setActiveSession(remaining[0].id)
      else setActiveSession(null)
    }
    setDeleteConfirm(null)
  }

  const addMessageToSession = useCallback((text, sender, sessionId) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const msg = { id: Date.now() + Math.random(), sender, text, timestamp: time }
    setSessionHistory((cur) =>
      cur.map((s) => {
        if (s.id !== sessionId) return s
        const updated = [...s.messages, msg]
        const userMsgs = updated.filter((m) => m.sender === 'user')
        let title = s.title
        if (userMsgs.length === 1 && (s.title === 'New Chat' || s.title === 'Welcome session')) {
          title = userMsgs[0].text.length > 30 ? userMsgs[0].text.slice(0, 27) + '\u2026' : userMsgs[0].text
        }
        const preview = userMsgs.map((m) => m.text).join(' \u00B7 ').slice(0, 60) || s.preview
        return { ...s, messages: updated, title, preview }
      }),
    )
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const text = inputValue.trim()
    if (!text || isTyping) return

    const sessionId = activeSession
    addMessageToSession(text, 'user', sessionId)
    setInputValue('')
    setIsTyping(true)
    setStreamingText('')

    const activeMsgs = sessionHistory.find(s => s.id === sessionId)?.messages || []
    const history = activeMsgs.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text,
    }))

    const controller = new AbortController()
    abortRef.current = controller
    streamingTextRef.current = ''

    try {
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, session_id: String(sessionId) }),
        signal: controller.signal,
      })

      if (!response.ok) throw new Error(`Backend error: ${response.status}`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      let buffer = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6))
              if (data.token) {
                fullText += data.token
                streamingTextRef.current = fullText
                setStreamingText(fullText)
              }
              if (data.error) {
                fullText = `Error: ${data.error}`
                streamingTextRef.current = fullText
                setStreamingText(fullText)
              }
            } catch { /* skip malformed JSON */ }
          }
        }
      }

      if (fullText) {
        addMessageToSession(fullText, 'bot', sessionId)
      }
      setStreamingText('')
    } catch (err) {
      if (err.name === 'AbortError') {
        const stopped = streamingTextRef.current
        if (stopped) {
          addMessageToSession(stopped + '\n\n*[Stopped]*', 'bot', sessionId)
        }
        setStreamingText('')
        streamingTextRef.current = ''
      } else {
        addMessageToSession(`Connection error: ${err.message}. Is the backend running?`, 'bot', sessionId)
        setStreamingText('')
      }
    } finally {
      abortRef.current = null
      streamingTextRef.current = ''
      setIsTyping(false)
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

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '14px', lineHeight: '1.5', color: '#374151' }}>
      {/* ── Floating Trigger ── */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          type="button"
          className="fixed z-[999] w-12 h-12 rounded-full text-white border-none cursor-pointer flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95"
          style={{
            ...posStyle,
            backgroundColor: primaryColor,
            boxShadow: `0 8px 28px ${primaryColor}66`,
            zIndex: zIndex,
          }}
          aria-label={`Open ${botName} chat`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-6 h-6">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
      )}

      {/* ── Chat Widget ── */}
      {isOpen && (
        <div
          className="fixed z-[999] flex flex-col w-[320px] max-w-[calc(100vw-32px)] h-[440px] max-h-[calc(100vh-80px)] bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.2)] overflow-hidden"
          style={{
            ...posStyle,
            zIndex: zIndex,
            opacity: animateShow ? 1 : 0,
            transform: animateShow ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.96)',
            transition: 'opacity 250ms ease-out, transform 250ms ease-out',
          }}
        >
          {/* ── Header ── */}
          <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ backgroundColor: primaryColor }}>
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
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => { setShowHistory((s) => !s); setSearchQuery('') }}
                className={`p-1.5 rounded-full border-none cursor-pointer transition-colors bg-transparent flex items-center justify-center ${showHistory ? 'text-white bg-white/20' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                title="Chat history"
                type="button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
                  <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </button>
              <button
                onClick={handleNewChat}
                className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 border-none cursor-pointer transition-colors bg-transparent flex items-center justify-center"
                title="New chat"
                type="button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
              <div className="w-px h-4 bg-white/20 mx-1" />
              <button
                onClick={handleClose}
                className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 border-none cursor-pointer transition-colors bg-transparent flex items-center justify-center"
                title="Close"
                type="button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 flex flex-col min-h-0 relative">

            {/* ── History Panel ── */}
            {showHistory && (
              <div className="absolute inset-0 bg-white z-20 flex flex-col">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => setShowHistory(false)}
                    className="p-1.5 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-200 border-none cursor-pointer transition-colors bg-transparent flex items-center gap-1.5"
                    type="button"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
                      <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                    <span className="text-xs font-semibold">Back</span>
                  </button>
                  <span className="text-sm font-bold text-gray-700 flex-1 text-left">Chat History</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-[--iskobots-primary]" style={{ backgroundColor: `${primaryColor}1a`, color: primaryColor }}>
                    {sessionHistory.length}
                  </span>
                </div>

                <div className="px-3 py-2.5 border-b border-gray-100 shrink-0">
                  <div className="relative">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input
                      type="text"
                      placeholder="Search chats..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full text-xs bg-gray-100 border border-transparent rounded-full pl-8 pr-4 py-2 focus:outline-none focus:bg-white text-gray-700 placeholder-gray-400 transition-colors"
                      style={{ '--tw-ring-color': `${primaryColor}4d` }}
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto py-2 px-2">
                  {filteredHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-gray-300">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      </svg>
                      <p className="text-xs m-0">No sessions found</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {filteredHistory.map((item) => {
                        const isActive = item.id === activeSession
                        return (
                          <div key={item.id} className="relative group/item rounded-xl overflow-hidden">
                            <button
                              type="button"
                              onClick={() => handleSessionClick(item.id)}
                              className={`w-full text-left px-3 py-3 cursor-pointer transition-all duration-150 border rounded-xl ${
                                isActive
                                  ? 'shadow-sm'
                                  : 'bg-transparent border-transparent hover:bg-gray-50 hover:border-gray-200'
                              }`}
                              style={isActive ? { backgroundColor: `${primaryColor}14`, borderColor: `${primaryColor}40` } : undefined}
                            >
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: isActive ? primaryColor : '#d1d5db' }} />
                                <p className={`m-0 text-left text-xs font-semibold truncate ${isActive ? '' : 'text-gray-700'}`} style={isActive ? { color: primaryColor } : undefined}>
                                  {item.title}
                                </p>
                              </div>
                              <p className="m-0 text-left text-[11px] text-gray-400 truncate pl-3.5">{item.preview}</p>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteClick(e, item)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-gray-300 hover:text-rose-500 hover:bg-rose-50 border-none cursor-pointer opacity-0 group-hover/item:opacity-100 transition-all duration-150 bg-transparent"
                              title="Delete session"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                                <path d="M10 11v6M14 11v6"></path>
                              </svg>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="px-3 py-3 border-t border-gray-100 shrink-0">
                  <button
                    type="button"
                    onClick={handleNewChat}
                    className="w-full py-2.5 rounded-xl text-white text-xs font-bold border-none cursor-pointer transition-colors"
                    style={{ backgroundColor: primaryColor }}
                  >
                    + New Chat
                  </button>
                </div>
              </div>
            )}

            {/* ── Messages ── */}
            <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 min-h-0" style={{ backgroundColor: '#f7f7f7' }}>
              {renderedMessages}

              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              {messages.length <= 2 && !isTyping && suggestions.length > 0 && (
                <div className="flex flex-col items-end gap-2 mt-1">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSuggestion(s.text)}
                      className="text-white text-xs font-medium px-4 py-2.5 rounded-2xl rounded-br-sm border-none cursor-pointer transition-all duration-200 hover:shadow-md active:scale-95"
                      style={{ backgroundColor: primaryColor }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* ── Input bar ── */}
            <form
              onSubmit={handleSubmit}
              className="px-3 py-3 bg-white border-t border-gray-100 flex items-center gap-2 shrink-0"
            >
              <input
                ref={inputRef}
                type="text"
                placeholder="Write your message..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { handleSubmit(e) } }}
                aria-label="Chat input"
                className="flex-1 text-sm text-gray-700 placeholder-gray-400 bg-gray-100 border border-transparent rounded-full px-4 py-2.5 outline-none focus:bg-white transition-colors"
              />
              {isTyping ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="w-9 h-9 shrink-0 rounded-full bg-rose-500 text-white border-none cursor-pointer flex items-center justify-center transition-all duration-200 hover:bg-rose-600 hover:shadow-md active:scale-95"
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
        </div>
      )}
    </div>
  )
}

export default ChatbotDesign

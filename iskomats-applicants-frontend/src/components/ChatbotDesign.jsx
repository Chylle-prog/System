import { useMemo, useState, useEffect, useRef, useCallback } from 'react'

const ISKOBOTS_CSS = `
  .iskobots-root *, .iskobots-root *::before, .iskobots-root *::after { box-sizing: border-box; }
  .iskobots-root { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5; color: #374151; }
  .ib-fixed { position: fixed !important; }
  .ib-abs { position: absolute !important; }
  .ib-rel { position: relative !important; }
  .ib-flex { display: flex !important; }
  .ib-grid { display: grid !important; }
  .ib-col { flex-direction: column; }
  .ib-ac { align-items: center; }
  .ib-as { align-items: flex-start; }
  .ib-ae { align-items: flex-end; }
  .ib-jc { justify-content: center; }
  .ib-js { justify-content: flex-start; }
  .ib-sb { justify-content: space-between; }
  .ib-f1 { flex: 1 1 0%; }
  .ib-shrink0 { flex-shrink: 0; }
  .ib-mnh0 { min-height: 0; }
  .ib-inset0 { top:0; right:0; bottom:0; left:0; }
  .ib-place { place-items: center; }
  .ib-ohy { overflow-y: auto; }
  .ib-oh { overflow: hidden; }
  .ib-g05 { gap: 0.125rem; }
  .ib-g1 { gap: 0.25rem; }
  .ib-g15 { gap: 0.375rem; }
  .ib-g2 { gap: 0.5rem; }
  .ib-g25 { gap: 0.625rem; }
  .ib-g3 { gap: 0.75rem; }
  .ib-w15 { width: 0.375rem; }
  .ib-h15 { height: 0.375rem; }
  .ib-w35 { width: 0.875rem; }
  .ib-h35 { height: 0.875rem; }
  .ib-w4 { width: 1rem; }
  .ib-h4 { height: 1rem; }
  .ib-w6 { width: 1.5rem; }
  .ib-h6 { height: 1.5rem; }
  .ib-w8 { width: 2rem; }
  .ib-h8 { height: 2rem; }
  .ib-w9 { width: 2.25rem; }
  .ib-h9 { height: 2.25rem; }
  .ib-w12 { width: 3rem; }
  .ib-h12 { height: 3rem; }
  .ib-wpx { width: 1px; }
  .ib-h4b { height: 1rem; }
  .ib-wfull { width: 100%; }
  .ib-maxw280 { max-width: 280px; }
  .ib-maxwvw { max-width: calc(100vw - 32px); }
  .ib-maxhvh { max-height: calc(100vh - 80px); }
  .ib-w320 { width: 320px; }
  .ib-h440 { height: 440px; }
  .ib-p15 { padding: 0.375rem; }
  .ib-p4 { padding: 1rem; }
  .ib-p5 { padding: 1.25rem; }
  .ib-mx1 { margin-left:0.25rem; margin-right:0.25rem; }
  .ib-mb05 { margin-bottom:0.125rem; }
  .ib-mt1 { margin-top:0.25rem; }
  .ib-m0 { margin:0; }
  .ib-txs { font-size: 0.75rem; line-height: 1rem; }
  .ib-tsm { font-size: 0.875rem; line-height: 1.25rem; }
  .ib-t10 { font-size: 10px; }
  .ib-t11 { font-size: 11px; }
  .ib-semi { font-weight: 600; }
  .ib-bold { font-weight: 700; }
  .ib-med { font-weight: 500; }
  .ib-ltight { line-height: 1.25; }
  .ib-lrelax { line-height: 1.625; }
  .ib-trunc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ib-tleft { text-align: left; }
  .ib-white { color: #fff; }
  .ib-gray3 { color: #d1d5db; }
  .ib-gray4 { color: #9ca3af; }
  .ib-gray5 { color: #6b7280; }
  .ib-gray6 { color: #4b5563; }
  .ib-gray7 { color: #374151; }
  .ib-gray8 { color: #1f2937; }
  .ib-rose6 { color: #e11d48; }
  .ib-white70 { color: rgba(255,255,255,0.7); }
  .ib-bgwhite { background-color: #fff; }
  .ib-bgg100 { background-color: #f3f4f6; }
  .ib-bgblk40 { background-color: rgba(0,0,0,0.4); }
  .ib-bgrose100 { background-color: #ffe4e6; }
  .ib-bgrose50 { background-color: #fff1f2; }
  .ib-bgw20 { background-color: rgba(255,255,255,0.2); }
  .ib-bgtrans { background-color: transparent; }
  .ib-chat-bg { background-color: #f7f7f7; }
  .ib-b { border-width:1px; border-style:solid; }
  .ib-bnone { border: none; }
  .ib-bt { border-top-width:1px; border-top-style:solid; }
  .ib-br { border-right-width:1px; border-right-style:solid; }
  .ib-bg100 { border-color:#f3f4f6; }
  .ib-bg200 { border-color:#e5e7eb; }
  .ib-btrans { border-color:transparent; }
  .ib-rfull { border-radius: 9999px; }
  .ib-r2xl { border-radius: 1rem; }
  .ib-rxl { border-radius: 0.75rem; }
  .ib-shsm { box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); }
  .ib-shxl { box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1); }
  .ib-blurb { backdrop-filter: blur(4px); }
  .ib-pnone { pointer-events: none; }
  .ib-ptr { cursor: pointer; }
  .ib-outline0 { outline: none; }
  .ib-z20 { z-index: 20; }
  .ib-z30 { z-index: 30; }
  .ib-tall { transition: all 150ms cubic-bezier(0.4,0,0.2,1); }
  .ib-tclr { transition: color 150ms, background-color 150ms, border-color 150ms; }
  @keyframes ib-bounce { 0%,100%{ transform:translateY(0) } 50%{ transform:translateY(-4px) } }
  @keyframes ib-pulse { 0%,100%{ opacity:1 } 50%{ opacity:0.5 } }
  .ib-bounce { animation: ib-bounce 1s infinite; }
  .ib-pulse { animation: ib-pulse 2s cubic-bezier(0.4,0,0.6,1) infinite; }
  .ib-iblock { display: inline-block; }
  .ib-hscale:hover { transform: scale(1.05); }
  .ib-hscale:active { transform: scale(0.95); }
  .ib-hshmd:hover { box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1); }
  .ib-hw10:hover { background-color: rgba(255,255,255,0.1); }
  .ib-hbgg200:hover { background-color: #e5e7eb; }
  .ib-hrose50:hover { background-color: #fff1f2; }
  .ib-hrose5:hover { color: #f43f5e; }
  .ib-hgray7:hover { color: #374151; }
  .ib-session-item:hover .ib-del-btn { opacity: 1; }
  .ib-del-btn { opacity: 0; transition: opacity 150ms; }
`

function ChatbotDesign({
  apiUrl: rawApiUrl = import.meta.env.VITE_CHATBOT_API_URL || import.meta.env.VITE_API_URL?.replace('/api', '') || 'https://iskomats-backend.onrender.com',
  botName = 'IskoBots',
  primaryColor = '#4F0D00',
  suggestions = [
    { id: 'a', label: 'What scholarships are available?', text: 'What scholarships are available?' },
    { id: 'b', label: 'How do I apply?', text: 'How do I apply for a scholarship?' },
    { id: 'c', label: 'What are the requirements?', text: 'What are the requirements to apply?' },
  ],
  position = 'bottom-right',
  zIndex = 999,
  userName: defaultUserName = '',
}) {
  const apiUrl = useMemo(() => (rawApiUrl || '').replace(/system-hxgp\.onrender\.com/, 'iskomats-backend.onrender.com'), [rawApiUrl])
  const [inputValue, setInputValue] = useState('')
  const [userName] = useState(() => localStorage.getItem('iskobots_userName') || defaultUserName)
  const [sessionHistory, setSessionHistory] = useState(() => {
    const name = localStorage.getItem('iskobots_userName') || defaultUserName || 'scholar'
    return [{
      id: 1, title: 'Welcome session', preview: `${botName} introduction.`,
      messages: [
        { id: 1, sender: 'bot', text: `Hi there 👋 Welcome, ${name}!`, timestamp: '' },
        { id: 2, sender: 'bot', text: 'How can I help you today?', timestamp: '' },
      ],
      date: 'Today',
    }]
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
    const active = sessionHistory.find(s => s.id === activeSession)
    return active ? active.messages : []
  }, [sessionHistory, activeSession])

  useEffect(() => {
    if (isOpen) { const t = setTimeout(() => setAnimateShow(true), 20); return () => clearTimeout(t) }
    else setAnimateShow(false)
  }, [isOpen])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [messages, isTyping])
  useEffect(() => { if (isOpen && animateShow) setTimeout(() => inputRef.current?.focus(), 100) }, [isOpen, animateShow])

  useEffect(() => {
    const cleanUrl = (apiUrl || '').replace(/\/+$/, '').replace(/\/api$/, '')
    fetch(`${cleanUrl}/api/health`)
      .then(r => r.json())
      .then(d => setBackendStatus(d.status === 'ok' || d.status === 'healthy' ? 'connected' : 'degraded'))
      .catch(() => setBackendStatus('disconnected'))
  }, [apiUrl])

  const handleOpen = () => { setIsOpen(true); setShowHistory(false) }
  const handleClose = () => { setAnimateShow(false); setTimeout(() => { setIsOpen(false); setShowHistory(false) }, 250) }

  const handleNewChat = () => {
    const newId = Date.now()
    const displayName = userName || 'scholar'
    const ns = { id: newId, title: 'New Chat', preview: 'No messages yet.',
      messages: [
        { id: 1, sender: 'bot', text: `Hi there 👋 Welcome, ${displayName}!`, timestamp: '' },
        { id: 2, sender: 'bot', text: 'How can I help you today?', timestamp: '' },
      ], date: 'Today' }
    setSessionHistory(cur => [ns, ...cur])
    setActiveSession(newId); setInputValue(''); setShowHistory(false)
  }

  const handleSessionClick = id => { setActiveSession(id); setInputValue(''); setShowHistory(false) }
  const handleDeleteClick = (e, session) => { e.stopPropagation(); setDeleteConfirm({ sessionId: session.id, title: session.title }) }
  const handleDeleteConfirmed = () => {
    const id = deleteConfirm.sessionId
    const remaining = sessionHistory.filter(s => s.id !== id)
    setSessionHistory(remaining)
    if (activeSession === id) setActiveSession(remaining.length > 0 ? remaining[0].id : null)
    setDeleteConfirm(null)
  }

  const addMessageToSession = useCallback((text, sender, sessionId) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const msg = { id: Date.now() + Math.random(), sender, text, timestamp: time }
    setSessionHistory(cur => cur.map(s => {
      if (s.id !== sessionId) return s
      const updated = [...s.messages, msg]
      const userMsgs = updated.filter(m => m.sender === 'user')
      let title = s.title
      if (userMsgs.length === 1 && (s.title === 'New Chat' || s.title === 'Welcome session'))
        title = userMsgs[0].text.length > 30 ? userMsgs[0].text.slice(0, 27) + '…' : userMsgs[0].text
      return { ...s, messages: updated, title, preview: userMsgs.map(m => m.text).join(' · ').slice(0, 60) || s.preview }
    }))
  }, [])

  const handleSubmit = async e => {
    e.preventDefault()
    const text = inputValue.trim()
    if (!text || isTyping) return
    const sessionId = activeSession
    addMessageToSession(text, 'user', sessionId)
    setInputValue(''); setIsTyping(true); setStreamingText('')
    const activeMsgs = sessionHistory.find(s => s.id === sessionId)?.messages || []
    const history = activeMsgs.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text }))
    const controller = new AbortController()
    abortRef.current = controller
    streamingTextRef.current = ''
    const cleanUrl = (apiUrl || '').replace(/\/+$/, '').replace(/\/api$/, '')
    try {
      const response = await fetch(`${cleanUrl}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, session_id: String(sessionId) }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Backend error: ${response.status}`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.token) { fullText += data.token; streamingTextRef.current = fullText; setStreamingText(fullText) }
              if (data.error) fullText = `Error: ${data.error}`
            } catch { /* skip */ }
          }
        }
      }
      if (fullText) addMessageToSession(fullText, 'bot', sessionId)
      setStreamingText('')
    } catch (err) {
      if (err.name === 'AbortError') {
        const stopped = streamingTextRef.current
        if (stopped) addMessageToSession(stopped + '\n\n*[Stopped]*', 'bot', sessionId)
        setStreamingText(''); streamingTextRef.current = ''
      } else {
        const lower = text.toLowerCase()
        let fallback = `I'm having trouble connecting right now. Please try again later.`
        if (lower.includes('scholarship') || lower.includes('available'))
          fallback = 'Check the Find Scholarships section for available opportunities.'
        else if (lower.includes('apply') || lower.includes('application'))
          fallback = 'To apply, go to Find Scholarships, select one, and follow the steps.'
        else if (lower.includes('requirement') || lower.includes('qualify'))
          fallback = 'Requirements vary by scholarship. Open a scholarship to see specifics.'
        addMessageToSession(fallback, 'bot', sessionId)
        setStreamingText('')
      }
    } finally { abortRef.current = null; streamingTextRef.current = ''; setIsTyping(false) }
  }

  const handleStop = () => { if (abortRef.current) abortRef.current.abort() }
  const handleSuggestion = text => { setInputValue(text); setTimeout(() => inputRef.current?.focus(), 50) }

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return sessionHistory
    const q = searchQuery.toLowerCase()
    return sessionHistory.filter(s => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q))
  }, [sessionHistory, searchQuery])

  const msgStyle = (isUser, pc) => ({
    maxWidth: '75%', padding: '0.625rem 1rem', fontSize: '0.875rem', lineHeight: '1.625',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    borderRadius: isUser ? '1rem 1rem 0.25rem 1rem' : '1rem 1rem 1rem 0.25rem',
    backgroundColor: isUser ? pc : '#fff', color: isUser ? '#fff' : '#374151',
    boxShadow: isUser ? 'none' : '0 1px 2px rgba(0,0,0,0.05)',
    border: isUser ? 'none' : '1px solid #f3f4f6',
  })

  const renderedMessages = useMemo(() => {
    const msgs = messages.map(msg => {
      const isUser = msg.sender === 'user'
      return (
        <div key={msg.id} style={{ display:'flex', flexDirection:'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap:'0.125rem' }}>
          <div style={msgStyle(isUser, primaryColor)}>{msg.text}</div>
          {msg.timestamp && <span style={{ fontSize:'10px', color:'#9ca3af', padding:'0 0.25rem' }}>{msg.timestamp}</span>}
        </div>
      )
    })
    if (streamingText) msgs.push(
      <div key="streaming" style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:'0.125rem' }}>
        <div style={msgStyle(false, primaryColor)}>
          {streamingText}
          <span style={{ display:'inline-block', width:'2px', height:'1rem', backgroundColor:'#9ca3af', marginLeft:'2px', animation:'ib-pulse 2s ease-in-out infinite', verticalAlign:'middle' }} />
        </div>
      </div>
    )
    return msgs
  }, [messages, streamingText, primaryColor])

  const statusColor = backendStatus === 'connected' ? '#34d399' : backendStatus === 'degraded' ? '#facc15' : '#f87171'
  const statusLabel = backendStatus === 'connected' ? 'Online' : backendStatus === 'degraded' ? 'Degraded' : 'Offline'

  return (
    <div className="iskobots-root">
      <style>{ISKOBOTS_CSS}</style>

      {!isOpen && (
        <button onClick={handleOpen} type="button"
          className="ib-fixed ib-rfull ib-white ib-bnone ib-ptr ib-flex ib-ac ib-jc ib-w12 ib-h12 ib-hscale"
          style={{ ...posStyle, backgroundColor: primaryColor, boxShadow: `0 8px 28px ${primaryColor}66`, zIndex }}
          aria-label={`Open ${botName} chat`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="ib-w6 ib-h6">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {isOpen && (
        <div className="ib-fixed ib-flex ib-col ib-w320 ib-maxwvw ib-h440 ib-maxhvh ib-bgwhite ib-r2xl ib-oh"
          style={{ ...posStyle, zIndex, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', opacity: animateShow ? 1 : 0,
            transform: animateShow ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.96)',
            transition: 'opacity 250ms ease-out, transform 250ms ease-out' }}>

          {/* Header */}
          <div className="ib-flex ib-ac ib-sb ib-shrink0" style={{ backgroundColor: primaryColor, padding:'0.75rem 1rem' }}>
            <div className="ib-flex ib-ac ib-g25">
              <div className="ib-w8 ib-h8 ib-rfull ib-bgw20 ib-grid ib-place ib-shrink0">
                <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="ib-w4 ib-h4">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div>
                <p className="ib-m0 ib-white ib-bold ib-tsm ib-ltight">{botName}</p>
                <p className="ib-m0 ib-white70 ib-t10 ib-flex ib-ac ib-g1">
                  <span className="ib-w15 ib-h15 ib-rfull ib-pulse ib-iblock" style={{ backgroundColor: statusColor }} />
                  {statusLabel}
                </p>
              </div>
            </div>
            <div className="ib-flex ib-ac ib-g05">
              <button onClick={() => { setShowHistory(s => !s); setSearchQuery('') }} type="button"
                className={`ib-p15 ib-rfull ib-bnone ib-ptr ib-tclr ib-bgtrans ib-flex ib-ac ib-jc ${showHistory ? 'ib-bgw20 ib-white' : 'ib-white70 ib-hw10'}`}
                title="Chat history">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="ib-w4 ib-h4">
                  <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              <button onClick={handleNewChat} type="button"
                className="ib-p15 ib-rfull ib-white70 ib-hw10 ib-bnone ib-ptr ib-tclr ib-bgtrans ib-flex ib-ac ib-jc" title="New chat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="ib-w4 ib-h4">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <div className="ib-wpx ib-h4b ib-bgw20 ib-mx1" />
              <button onClick={handleClose} type="button"
                className="ib-p15 ib-rfull ib-white70 ib-hw10 ib-bnone ib-ptr ib-tclr ib-bgtrans ib-flex ib-ac ib-jc" title="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="ib-w4 ib-h4">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="ib-f1 ib-flex ib-col ib-mnh0 ib-rel">

            {showHistory && (
              <div className="ib-abs ib-inset0 ib-bgwhite ib-z20 ib-flex ib-col">
                <div className="ib-flex ib-ac ib-g3 ib-shrink0"
                  style={{ padding:'0.75rem 1rem', backgroundColor:'#f9fafb', borderBottom:'1px solid #e5e7eb' }}>
                  <button onClick={() => setShowHistory(false)} type="button"
                    className="ib-p15 ib-rfull ib-gray5 ib-hgray7 ib-hbgg200 ib-bnone ib-ptr ib-tclr ib-bgtrans ib-flex ib-ac ib-g15">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="ib-w4 ib-h4">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                    <span className="ib-txs ib-semi">Back</span>
                  </button>
                  <span className="ib-tsm ib-bold ib-gray7 ib-f1 ib-tleft">Chat History</span>
                  <span className="ib-txs ib-bold ib-rfull"
                    style={{ padding:'0.125rem 0.5rem', backgroundColor:`${primaryColor}1a`, color:primaryColor }}>
                    {sessionHistory.length}
                  </span>
                </div>
                <div className="ib-shrink0" style={{ padding:'0.625rem 0.75rem', borderBottom:'1px solid #f3f4f6' }}>
                  <div className="ib-rel">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      className="ib-abs ib-w35 ib-h35 ib-gray4 ib-pnone"
                      style={{ left:'0.75rem', top:'50%', transform:'translateY(-50%)' }}>
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input type="text" placeholder="Search chats..." value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="ib-wfull ib-txs ib-bgg100 ib-b ib-btrans ib-rfull ib-gray7 ib-outline0 ib-tclr"
                      style={{ paddingLeft:'2rem', paddingRight:'1rem', paddingTop:'0.5rem', paddingBottom:'0.5rem' }} />
                  </div>
                </div>
                <div className="ib-f1 ib-ohy" style={{ padding:'0.5rem' }}>
                  {filteredHistory.length === 0 ? (
                    <div className="ib-flex ib-col ib-ac ib-jc ib-gray4" style={{ paddingTop:'3rem', gap:'0.5rem' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ib-w8 ib-h8 ib-gray3">
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <p className="ib-txs ib-m0">No sessions found</p>
                    </div>
                  ) : (
                    <div className="ib-flex ib-col ib-g1">
                      {filteredHistory.map(item => {
                        const isActive = item.id === activeSession
                        return (
                          <div key={item.id} className="ib-rel ib-rxl ib-oh ib-session-item">
                            <button type="button" onClick={() => handleSessionClick(item.id)}
                              className="ib-wfull ib-tleft ib-ptr ib-tall ib-b ib-rxl"
                              style={{ padding:'0.75rem', backgroundColor: isActive ? `${primaryColor}14` : 'transparent',
                                borderColor: isActive ? `${primaryColor}40` : 'transparent', cursor:'pointer' }}>
                              <div className="ib-flex ib-ac ib-g2 ib-mb05">
                                <span className="ib-w15 ib-h15 ib-rfull ib-shrink0"
                                  style={{ backgroundColor: isActive ? primaryColor : '#d1d5db' }} />
                                <p className="ib-m0 ib-tleft ib-txs ib-semi ib-trunc"
                                  style={{ color: isActive ? primaryColor : '#374151' }}>{item.title}</p>
                              </div>
                              <p className="ib-m0 ib-tleft ib-t11 ib-gray4 ib-trunc" style={{ paddingLeft:'0.875rem' }}>{item.preview}</p>
                            </button>
                            <button type="button" onClick={e => handleDeleteClick(e, item)}
                              className="ib-abs ib-p15 ib-rfull ib-gray3 ib-hrose5 ib-hrose50 ib-bnone ib-ptr ib-tall ib-bgtrans ib-del-btn"
                              style={{ right:'0.5rem', top:'50%', transform:'translateY(-50%)' }} title="Delete session">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ib-w35 ib-h35">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                <path d="M10 11v6M14 11v6" />
                              </svg>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="ib-shrink0" style={{ padding:'0.75rem', borderTop:'1px solid #f3f4f6' }}>
                  <button type="button" onClick={handleNewChat}
                    className="ib-wfull ib-white ib-txs ib-bold ib-bnone ib-ptr ib-tclr ib-rxl"
                    style={{ padding:'0.625rem', backgroundColor: primaryColor }}>
                    + New Chat
                  </button>
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="ib-f1 ib-ohy ib-flex ib-col ib-mnh0 ib-chat-bg" style={{ padding:'1rem', gap:'0.75rem' }}>
              {renderedMessages}
              {isTyping && (
                <div style={{ display:'flex', justifyContent:'flex-start' }}>
                  <div className="ib-bgwhite ib-b ib-bg100 ib-shsm ib-r2xl ib-flex ib-ac ib-g1"
                    style={{ borderBottomLeftRadius:'0.25rem', padding:'0.75rem 1rem' }}>
                    {[0,150,300].map(d => (
                      <span key={d} className="ib-w15 ib-h15 ib-rfull ib-bounce"
                        style={{ backgroundColor:'#9ca3af', animationDelay:`${d}ms` }} />
                    ))}
                  </div>
                </div>
              )}
              {messages.length <= 2 && !isTyping && suggestions.length > 0 && (
                <div className="ib-flex ib-col ib-ae ib-g2 ib-mt1">
                  {suggestions.map(s => (
                    <button key={s.id} type="button" onClick={() => handleSuggestion(s.text)}
                      className="ib-white ib-txs ib-med ib-bnone ib-ptr ib-hshmd ib-r2xl"
                      style={{ padding:'0.625rem 1rem', backgroundColor: primaryColor, borderBottomRightRadius:'0.25rem' }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="ib-flex ib-ac ib-g2 ib-shrink0 ib-bgwhite ib-bt ib-bg100"
              style={{ padding:'0.75rem' }}>
              <input ref={inputRef} type="text" placeholder="Write your message..." value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e) }}
                aria-label="Chat input"
                className="ib-f1 ib-tsm ib-gray7 ib-bgg100 ib-b ib-btrans ib-rfull ib-outline0 ib-tclr"
                style={{ padding:'0.625rem 1rem' }} />
              {isTyping ? (
                <button type="button" onClick={handleStop}
                  className="ib-w9 ib-h9 ib-shrink0 ib-rfull ib-white ib-bnone ib-ptr ib-flex ib-ac ib-jc ib-hscale"
                  style={{ backgroundColor:'#f43f5e' }} title="Stop">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="ib-w4 ib-h4">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button type="submit"
                  className="ib-w9 ib-h9 ib-shrink0 ib-rfull ib-white ib-bnone ib-ptr ib-flex ib-ac ib-jc ib-hscale"
                  style={{ backgroundColor: inputValue.trim() ? primaryColor : '#d1d5db',
                    cursor: inputValue.trim() ? 'pointer' : 'not-allowed' }}
                  disabled={!inputValue.trim()} title="Send">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round" className="ib-w4 ib-h4">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              )}
            </form>

            {/* Delete confirmation */}
            {deleteConfirm && (
              <div className="ib-abs ib-inset0 ib-z30 ib-flex ib-ac ib-jc ib-p4 ib-bgblk40 ib-blurb">
                <div className="ib-bgwhite ib-r2xl ib-shxl ib-oh" style={{ width:'100%', maxWidth:'280px' }}>
                  <div className="ib-p5 ib-tleft">
                    <div className="ib-flex ib-ac ib-g3" style={{ marginBottom:'0.75rem' }}>
                      <div className="ib-w9 ib-h9 ib-rfull ib-bgrose100 ib-grid ib-place ib-shrink0">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#e11d48" strokeWidth="2" className="ib-w4 ib-h4">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        </svg>
                      </div>
                      <p className="ib-m0 ib-tsm ib-bold ib-gray8">Delete chat?</p>
                    </div>
                    <p className="ib-m0 ib-txs ib-gray5 ib-lrelax">
                      "<span className="ib-semi ib-gray7">{deleteConfirm.title}</span>" will be permanently removed. This cannot be undone.
                    </p>
                  </div>
                  <div className="ib-flex ib-bt ib-bg100">
                    <button type="button" onClick={() => setDeleteConfirm(null)}
                      className="ib-f1 ib-tsm ib-gray6 ib-semi ib-bnone ib-ptr ib-bgtrans ib-br ib-bg100"
                      style={{ padding:'0.75rem' }}>Cancel</button>
                    <button type="button" onClick={handleDeleteConfirmed}
                      className="ib-f1 ib-tsm ib-rose6 ib-bold ib-bnone ib-ptr ib-bgtrans"
                      style={{ padding:'0.75rem' }}>Delete</button>
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
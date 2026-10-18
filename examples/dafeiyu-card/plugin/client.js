// 大肥鱼卡内插件（浏览器侧）：用 registerStageView 画 Galgame 式舞台。
// 背景、服装立绘、背景音乐都来自宿主侧导演定下的场景；翻页、自动、输入框仍由 Tavern 负责。
window.__ModuleLoader__.load({
  id: 'dsh-card-dafeiyu-galgame',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    // SillyTavern's 28 emotions → this figure's own expressions.
    const EMOTIONS = { joy: 'joy', amusement: 'joy', excitement: 'joy', optimism: 'joy', approval: 'joy', gratitude: 'joy', relief: 'joy', admiration: 'joy', caring: 'joy',
      anger: 'anger', annoyance: 'anger', disapproval: 'anger', sadness: 'sad', grief: 'crying', disappointment: 'sad', remorse: 'sad',
      nervousness: 'anxious', fear: 'anxious', confusion: 'anxious', surprise: 'anxious', neutral: 'calm', curiosity: 'calm', realization: 'calm',
      embarrassment: 'shy', disgust: 'disgust', love: 'love', desire: 'love', pride: 'smug' }

    // One music player for the page: the same track keeps playing across beats; a new one fades in.
    const music = { audio: null, url: '' }
    function playMusic(url) {
      if (url === music.url) return
      const previous = music.audio
      music.url = url
      music.audio = null
      if (previous) fade(previous, 0, () => previous.pause())
      if (!url) return
      const audio = new Audio(url)
      audio.loop = true
      audio.volume = 0
      music.audio = audio
      audio.play().then(() => fade(audio, 0.45), () => {})
    }
    function fade(audio, target, done) {
      const step = () => {
        const next = audio.volume + Math.sign(target - audio.volume) * 0.05
        if (Math.abs(target - audio.volume) <= 0.05) { audio.volume = target; done && done(); return }
        audio.volume = Math.min(1, Math.max(0, next)); setTimeout(step, 60)
      }
      step()
    }

    function useScene(ui, gameId, turn) {
      const [scene, setScene] = React.useState(null)
      const [version, setVersion] = React.useState(0)
      React.useEffect(() => ui.watchTurnState(gameId, () => setVersion(value => value + 1)), [gameId])
      React.useEffect(() => {
        let active = true
        ui.callHost('dsh-card-dafeiyu-galgame/scene', { gameId, turn: turn || 0 }).then(value => { if (active) setScene(value) }, () => {})
        return () => { active = false }
      }, [gameId, turn, version])
      return scene
    }

    function Stage({ ui, gameId, stage, beats, index, beat, fullscreen, advance, footer }) {
      const scene = useScene(ui, gameId, beat && beat.turn)
      React.useEffect(() => { if (scene) playMusic(scene.music ? scene.music.url : '') }, [scene && scene.music && scene.music.url])
      React.useEffect(() => () => playMusic(''), [])
      const figure = scene && scene.figure
      let emotion = figure ? figure.defaultEmotion : 'calm'
      for (const item of beats.slice(0, index + 1)) if (figure && item.kind === 'line' && figure.names.includes(item.speaker)) emotion = EMOTIONS[item.emotion] || figure.defaultEmotion
      const speaking = beat && beat.kind === 'line' && figure && figure.names.includes(beat.speaker)
      const portrait = figure && (figure.avatars[emotion] || figure.avatars[figure.defaultEmotion])
      return h('div', { onClick: advance, style: { position: 'relative', height: fullscreen ? '100%' : 360, minHeight: 260, overflow: 'hidden', borderRadius: fullscreen ? 0 : 8, cursor: 'pointer', color: '#fff', background: '#1d2433' } },
        scene && scene.background ? h('img', { src: scene.background.url, alt: '', style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } }) : null,
        scene && scene.background ? h('div', { style: { position: 'absolute', top: 10, left: 12, fontSize: 12, padding: '2px 10px', borderRadius: 12, background: 'rgba(0,0,0,.4)' } },
          scene.background.name + (scene.music ? ' · ♪ ' + scene.music.name : '')) : null,
        portrait ? h('img', { src: portrait, alt: figure.names[0], style: { position: 'absolute', bottom: 96, left: '50%', transform: 'translateX(-50%)' + (speaking ? ' translateY(-4px)' : ''), maxHeight: '62%', maxWidth: '80%', objectFit: 'contain', transition: 'transform .3s', filter: beat && beat.kind === 'line' && !speaking ? 'brightness(.75)' : 'none' } }) : null,
        h('div', { style: { position: 'absolute', left: 12, right: 12, bottom: 12, minHeight: 80, padding: '10px 14px', borderRadius: 8, background: 'rgba(10,20,40,.72)' } },
          beat && beat.kind === 'line' ? h('div', { style: { fontWeight: 600, marginBottom: 4, color: speaking ? '#8fb7ff' : '#fff' } }, beat.speaker) : null,
          h('div', { style: { lineHeight: 1.6, fontStyle: beat && beat.kind === 'narration' ? 'italic' : 'normal' } }, beat ? beat.text : '还没有可以演出的正文'),
          footer))
    }

    return {
      name: 'dsh-card-dafeiyu-galgame',
      inject: ['tavernUi'],
      apply(ctx) {
        const ui = ctx.tavernUi
        if (typeof ui.registerStageView !== 'function') return
        ui.registerStageView({ id: 'galgame', label: '大肥鱼舞台', render: input => h(Stage, { ui, ...input }) })
      },
    }
  },
})

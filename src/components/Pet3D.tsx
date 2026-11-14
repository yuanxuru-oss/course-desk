import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { PetState } from './usePetState'

interface Props {
  state: PetState
  facing: 1 | -1
  sleepy?: boolean
  excited?: boolean
  /** 眼睛朝向,取值 -1~1;桌面外壳里由全局鼠标位置换算而来 */
  look?: { x: number; y: number }
  /** 每次点击递增,用来触发一次蹦跳 */
  hopPulse?: number
}

/**
 * 3D 版小兔桌宠。
 *
 * 现搭几何体而不是加载模型:球 + 胶囊 + 圆柱就够了,省掉几百 KB 的 GLB;
 * 「卡通着色 + 反向外壳描边」拿到米菲那种平涂粗描边的味道。
 *
 * 参考:
 *   - agent-pet-hub:状态驱动的姿势切换(idle / 走 / 拖 / 睡)
 *   - meowverlay 的性能经验:帧率要压、不可见时别渲染
 * 所以这里锁 40fps,页面隐藏时直接停。
 */
export default function Pet3D({ state, facing, sleepy = false, excited = false, look, hopPulse = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef({ state, facing, sleepy, excited, look, hopPulse })
  stateRef.current = { state, facing, sleepy, excited, look, hopPulse }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      return
    }

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
    // 取景:让「耳朵尖 ~ 脚底」正好落在画面里,四周留一点空气
    camera.position.set(0, 2.3, 9.6)
    camera.lookAt(0, 1.62, 0)

    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setClearColor(0x000000, 0)
    host.appendChild(renderer.domElement)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'

    /* ---------- 材质:三阶卡通着色 ---------- */
    const grad = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat)
    grad.minFilter = THREE.NearestFilter
    grad.magFilter = THREE.NearestFilter
    grad.needsUpdate = true
    const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: grad })

    const INK = 0x241f1a
    const outlineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide })
    /** 反向外壳描边:同一几何体放大一点、只画背面,就有粗黑线 */
    const outline = (mesh: THREE.Mesh, k = 1.06) => {
      const o = new THREE.Mesh(mesh.geometry, outlineMat)
      o.scale.multiplyScalar(k)
      mesh.add(o)
      return mesh
    }

    const root = new THREE.Group()
    root.position.y = -0.9
    scene.add(root)

    /* 裙子 */
    const dress = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.92, 1.15, 28), toon(0xe5763a))
    dress.position.y = 0.58
    outline(dress, 1.045)
    root.add(dress)

    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.06), toon(0xd2622b))
    pocket.position.set(0, 0.42, 0.83)
    pocket.rotation.x = -0.08
    root.add(pocket)

    /* 手 */
    const armGeo = new THREE.CapsuleGeometry(0.13, 0.42, 6, 12)
    const arms: THREE.Mesh[] = []
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, toon(0xfffdf7))
      arm.position.set(side * 0.68, 0.95, 0.05)
      arm.rotation.z = side * 0.45
      outline(arm, 1.1)
      root.add(arm)
      arms.push(arm)
    }

    /* 脚 */
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 14), toon(0xfffdf7))
      foot.scale.set(1, 0.62, 1.2)
      foot.position.set(side * 0.28, 0.04, 0.3)
      outline(foot, 1.07)
      root.add(foot)
    }

    /* 头 */
    const head = new THREE.Group()
    head.position.y = 1.98
    root.add(head)

    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), toon(0xfffdf7))
    skull.scale.set(1, 0.94, 0.96)
    outline(skull, 1.045)
    head.add(skull)

    const ears: THREE.Mesh[] = []
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.72, 8, 16), toon(0xfffdf7))
      ear.position.set(side * 0.33, 0.92, -0.02)
      ear.rotation.z = side * 0.14
      outline(ear, 1.1)
      head.add(ear)
      ears.push(ear)
    }

    const eyes = new THREE.Group()
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 16), new THREE.MeshBasicMaterial({ color: INK }))
      eye.position.set(side * 0.33, 0.05, 0.94)
      eyes.add(eye)
    }
    head.add(eyes)

    for (const dir of [1, -1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.3, 0.05), new THREE.MeshBasicMaterial({ color: INK }))
      bar.position.set(0, -0.33, 0.95)
      bar.rotation.z = dir * Math.PI / 4
      head.add(bar)
    }

    /* 灯光 */
    scene.add(new THREE.HemisphereLight(0xfffdf7, 0xf3dcc0, 1.15))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(3, 6, 5)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xffd9b0, 0.7)
    rim.position.set(-4, 2, -3)
    scene.add(rim)

    const resize = () => {
      const w = host.clientWidth || 200
      const h = host.clientHeight || 220
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    /* 鼠标视差:兔子会偏头看你 */
    const target = { x: 0, y: 0 }
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect()
      target.x = ((e.clientX - r.left) / r.width - 0.5) * 0.5
      target.y = ((e.clientY - r.top) / r.height - 0.5) * 0.3
    }
    window.addEventListener('pointermove', onMove)

    /* 点一下会蹦 */
    let hop = 0
    const onClick = () => {
      hop = 1
    }
    host.addEventListener('pointerdown', onClick)

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const clock = new THREE.Clock()
    let raf = 0
    let blinkAt = 2 + Math.random() * 3
    let lastPulse = 0
    let last = 0
    const FPS_CAP = 40

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      // 锁帧:桌面小宠物不需要 60fps,省电也省 CPU
      if (now - last < 1000 / FPS_CAP) return
      last = now
      if (document.hidden) return

      const t = clock.getElapsedTime()
      const { state: st, facing: face, excited: x, look: lk, hopPulse: pulse } = stateRef.current
      const sleeping = st === 'sleep'

      // 外部点了它一下 → 蹦起来
      if (pulse !== lastPulse) {
        lastPulse = pulse
        hop = 1
      }

      const bobSpeed = x ? 2.2 : st === 'walk' ? 3.4 : st === 'sleep' ? 0.7 : 1.25
      const bobAmp = st === 'walk' ? 0.075 : x ? 0.09 : sleeping ? 0.02 : 0.05
      hop = Math.max(0, hop - 0.045)
      const jump = Math.sin(hop * Math.PI) * 0.55

      root.position.y = -0.9 + (reduced ? 0 : Math.sin(t * bobSpeed) * bobAmp) + jump

      /*
       * 朝向:身子几乎不动,主要靠**转头**看你。
       * 一开始让整个 root 转,结果鼠标移到边上时整只兔子侧过去、脸都看不见了 —— 太夸张。
       */
      const bodyYaw = st === 'walk' ? face * 0.26 : lk ? lk.x * 0.1 : 0.05
      root.rotation.y += (bodyYaw - root.rotation.y) * 0.1

      const headYaw = lk ? lk.x * 0.62 : 0
      head.rotation.y += (headYaw - head.rotation.y) * 0.14
      const pitchTarget = lk ? lk.y * 0.26 : target.y
      head.rotation.x += (pitchTarget - head.rotation.x) * 0.1
      head.rotation.z = sleeping ? 0.14 : 0

      // 眼珠再往鼠标方向偏一点,近看就是"眼神跟着走"
      if (lk) {
        eyes.position.x += (lk.x * 0.05 - eyes.position.x) * 0.18
        eyes.position.y += (-lk.y * 0.04 - eyes.position.y) * 0.18
      }

      // 走路时轻轻晃;被拎起来时往后仰
      root.rotation.z =
        st === 'walk' ? Math.sin(t * 6) * 0.05 : st === 'drag' ? -0.18 : Math.sin(t * 1.1) * 0.012

      // 下落时拉伸
      const stretch = st === 'fall' ? 1.06 : 1
      root.scale.y += (stretch - root.scale.y) * 0.2

      // 耳朵:走起来甩、被拎起来立起、睡着耷拉
      ears.forEach((ear, i) => {
        const dir = i === 0 ? 1 : -1
        const base = dir * (st === 'drag' ? 0.05 : sleeping ? 0.3 : 0.14)
        const sway = reduced ? 0 : Math.sin(t * (st === 'walk' ? 5 : 1.6) + i * 0.8) * (sleeping ? 0.02 : 0.07)
        ear.rotation.z = base + dir * sway
      })

      // 手:睡着垂下来,走路前后摆
      arms.forEach((arm, i) => {
        const dir = i === 0 ? 1 : -1
        arm.rotation.z = dir * (sleeping ? 0.75 : st === 'walk' ? 0.45 + Math.sin(t * 5 + i * Math.PI) * 0.25 : 0.45)
      })

      // 眨眼:睡着一直闭着
      if (sleeping) {
        eyes.scale.y += (0.16 - eyes.scale.y) * 0.2
      } else if (st === 'drag' || st === 'fall') {
        eyes.scale.y += (1.25 - eyes.scale.y) * 0.2 // 睁大
      } else if (t > blinkAt) {
        eyes.scale.y = 0.12
        if (t > blinkAt + 0.16) blinkAt = t + 2.6 + Math.random() * 3.4
      } else {
        eyes.scale.y += (1 - eyes.scale.y) * 0.35
      }

      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerdown', onClick)
      renderer.dispose()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
      })
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={hostRef} className="w-full h-full" />
}
// 서버에 넣으면 안 되는 모드 알아보기
// 'client'      : 게임하는 사람 전용(클라이언트 전용) 모드
//   1) jar 안의 정보 파일: fabric.mod.json / quilt.mod.json 의 environment "client", mods.toml 의 clientSideOnly=true
//   2) Modrinth에 파일 지문(sha1)으로 물어봐서 "서버 미지원"
// 'clientMixin' : 서버에서도 쓰는 모드인데, 양쪽에 적용되는 mixin 목록에 게임 화면 코드(net.minecraft.client)를 고치는 것이 들어 있어서
//                 서버에서 켜면 반드시 튕기는 모드 (모드 쪽 실수. 게임에서는 잘 돌아간다)
// 확인이 안 되면(인터넷 오류, 모르는 파일, 읽을 수 없는 jar) 서버에 넣어도 되는 것으로 본다
import crypto from 'crypto'
import fs from 'fs'
import yauzl from 'yauzl'
import * as modrinth from './modrinth'

export type OffReason = 'client' | 'clientMixin'

const META = ['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml', 'META-INF/MANIFEST.MF']

// jar 안에서 원하는 파일들만 읽는다 (이름 -> 내용). jar 안에 든 jar는 Buffer로 넘긴다
export function readEntries(jar: string | Buffer, want: (name: string) => boolean): Promise<Map<string, Buffer>> {
  return new Promise((resolve) => {
    const out = new Map<string, Buffer>()
    const open = (cb: (err: Error | null, zip?: yauzl.ZipFile) => void): void =>
      typeof jar === 'string' ? yauzl.open(jar, { lazyEntries: true, decodeStrings: true }, cb) : yauzl.fromBuffer(jar, { lazyEntries: true, decodeStrings: true }, cb)
    open((err, zip) => {
      if (err || !zip) return resolve(out)
      const done = (): void => {
        zip.close()
        resolve(out)
      }
      zip.on('error', done)
      zip.on('end', done)
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!want(entry.fileName) || entry.uncompressedSize > 2_000_000) return zip.readEntry()
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return zip.readEntry()
          const parts: Buffer[] = []
          stream.on('data', (b: Buffer) => parts.push(b))
          stream.on('error', () => zip.readEntry())
          stream.on('end', () => {
            out.set(entry.fileName, Buffer.concat(parts))
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}

const text = (m: Map<string, Buffer>, name: string): string => m.get(name)?.toString('utf8') ?? ''

function metaSaysClient(m: Map<string, string>): boolean {
  if (/"environment"\s*:\s*"client"/.test(m.get('fabric.mod.json') ?? '')) return true
  if (/"environment"\s*:\s*"client"/.test(m.get('quilt.mod.json') ?? '')) return true
  return /^\s*clientSideOnly\s*=\s*true/m.test((m.get('META-INF/mods.toml') ?? '') + (m.get('META-INF/neoforge.mods.toml') ?? ''))
}

// 서버에서도 쓰이는 mixin 설정 파일 이름들
function serverMixinConfigs(m: Map<string, string>): string[] {
  const out: string[] = []
  for (const name of ['fabric.mod.json', 'quilt.mod.json']) {
    try {
      const j = JSON.parse(m.get(name) ?? 'null')
      const list = name === 'quilt.mod.json' ? j?.mixin : j?.mixins
      for (const e of Array.isArray(list) ? list : list ? [list] : []) {
        if (typeof e === 'string') out.push(e)
        else if (e && typeof e.config === 'string' && e.environment !== 'client') out.push(e.config)
      }
    } catch {
      // 주석이 들어 있는 등 읽을 수 없으면 넘어간다
    }
  }
  const toml = (m.get('META-INF/mods.toml') ?? '') + '\n' + (m.get('META-INF/neoforge.mods.toml') ?? '')
  for (const x of toml.matchAll(/\[\[mixins\]\][^[]*?config\s*=\s*"([^"]+)"/g)) out.push(x[1])
  const mf = (m.get('META-INF/MANIFEST.MF') ?? '').replace(/\r?\n /g, '')
  const line = mf.match(/^MixinConfigs:\s*(.+)$/m)
  if (line) out.push(...line[1].split(',').map((s) => s.trim()).filter(Boolean))
  return [...new Set(out)]
}

// 클래스 파일에서 @Mixin 이 고치려는 대상 클래스 이름들을 꺼낸다 (못 읽으면 빈 목록)
function mixinTargets(b: Buffer): string[] {
  try {
    let p = 8
    const u2 = (): number => {
      const v = b.readUInt16BE(p)
      p += 2
      return v
    }
    const n = u2()
    const utf8: (string | undefined)[] = []
    for (let i = 1; i < n; i++) {
      const tag = b[p++]
      if (tag === 1) {
        const len = u2()
        utf8[i] = b.toString('utf8', p, p + len)
        p += len
      } else if (tag === 5 || tag === 6) {
        p += 8
        i++
      } else if ([3, 4, 9, 10, 11, 12, 17, 18].includes(tag)) p += 4
      else if (tag === 15) p += 3
      else if ([7, 8, 16, 19, 20].includes(tag)) p += 2
      else return []
    }
    // accessor·invoker(인터페이스) mixin은 대상이 없어도 경고만 나고 서버가 켜진다. 일반 mixin만 본다
    if (b.readUInt16BE(p) & 0x0200) return []
    p += 6
    const interfaces = u2()
    p += interfaces * 2
    const skipMembers = (): void => {
      const count = u2()
      for (let i = 0; i < count; i++) {
        p += 6
        const attrs = u2()
        for (let a = 0; a < attrs; a++) {
          p += 2
          p += b.readUInt32BE(p) + 4
        }
      }
    }
    skipMembers() // 필드
    skipMembers() // 메서드
    const targets: string[] = []
    const readValue = (into: string[] | null): void => {
      const tag = String.fromCharCode(b[p++])
      if ('BCDFIJSZs'.includes(tag)) {
        const idx = u2()
        if (into && tag === 's' && utf8[idx]) into.push(utf8[idx]!)
      } else if (tag === 'c') {
        const idx = u2()
        if (into && utf8[idx]) into.push(utf8[idx]!.replace(/^L|;$/g, ''))
      } else if (tag === 'e') p += 4
      else if (tag === '@') readAnnotation()
      else if (tag === '[') {
        const count = u2()
        for (let i = 0; i < count; i++) readValue(into)
      }
    }
    const readAnnotation = (): void => {
      const type = utf8[u2()]
      const pairs = u2()
      for (let i = 0; i < pairs; i++) {
        const key = utf8[u2()]
        readValue(type === 'Lorg/spongepowered/asm/mixin/Mixin;' && (key === 'value' || key === 'targets') ? targets : null)
      }
    }
    const attrs = u2()
    for (let a = 0; a < attrs; a++) {
      const name = utf8[u2()]
      const len = b.readUInt32BE(p)
      p += 4
      const end = p + len
      if (name === 'RuntimeInvisibleAnnotations' || name === 'RuntimeVisibleAnnotations') {
        const count = u2()
        for (let i = 0; i < count; i++) readAnnotation()
      }
      p = end
    }
    return targets.map((t) => t.replace(/\./g, '/'))
  } catch {
    return []
  }
}

// 양쪽에 적용되는 mixin 중에 게임 화면 코드를 고치는 것이 있고, 실패하면 멈추게(required) 돼 있는지
async function hasClientMixin(jar: string, meta: Map<string, string>): Promise<boolean> {
  const configs = serverMixinConfigs(meta)
  if (!configs.length) return false
  const files = await readEntries(jar, (n) => configs.includes(n))
  const classes: string[] = []
  for (const name of configs) {
    try {
      const c = JSON.parse(text(files, name))
      // plugin이 있으면 mixin을 알아서 거를 수 있어서, 실패해도 멈추지 않으면(required 아님) 괜찮아서 뺀다
      if (c.plugin || c.required !== true || typeof c.package !== 'string') continue
      for (const m of Array.isArray(c.mixins) ? c.mixins : []) if (typeof m === 'string') classes.push(`${c.package}.${m}`.replace(/\./g, '/') + '.class')
    } catch {
      // 읽을 수 없는 설정은 넘어간다
    }
  }
  if (!classes.length) return false
  const bytes = await readEntries(jar, (n) => classes.includes(n))
  for (const b of bytes.values()) if (mixinTargets(b).some((t) => t.startsWith('net/minecraft/client/'))) return true
  return false
}

// jar 안만 보고 알 수 있는 것. 파일 크기·수정 시각이 같으면 다시 열지 않는다 (서버를 켤 때마다 빨라야 해서)
interface LocalInfo {
  client: boolean // 정보 파일에 클라이언트 전용이라고 적혀 있음
  clientMixin: boolean // 서버에서 튕기는 mixin이 있음
  id: string | null // 모드 ID (업데이트로 파일 이름이 바뀌어도 같은 모드인지 알아보려고)
}
const localCache = new Map<string, { key: string; info: LocalInfo }>()

function modIdOf(meta: Map<string, string>): string | null {
  try {
    const f = meta.get('fabric.mod.json')
    if (f) return JSON.parse(f).id ?? null
    const q = meta.get('quilt.mod.json')
    if (q) return JSON.parse(q).quilt_loader?.id ?? null
  } catch {
    // 읽을 수 없으면 아래 toml로
  }
  const t = (meta.get('META-INF/neoforge.mods.toml') ?? '') + (meta.get('META-INF/mods.toml') ?? '')
  return t.match(/\[\[mods\]\][^[]*?modId\s*=\s*"([^"]+)"/)?.[1] ?? null
}

export async function localInfo(jar: string): Promise<LocalInfo> {
  let key = ''
  try {
    const st = fs.statSync(jar)
    key = `${st.size}:${st.mtimeMs}`
  } catch {
    // 파일이 없으면 캐시 없이 본다
  }
  const hit = localCache.get(jar)
  if (hit && key && hit.key === key) return hit.info
  const raw = await readEntries(jar, (n) => META.includes(n)).catch(() => new Map<string, Buffer>())
  const meta = new Map([...raw].map(([k, v]) => [k, v.toString('utf8')]))
  const client = metaSaysClient(meta)
  const info: LocalInfo = { client, clientMixin: !client && (await hasClientMixin(jar, meta).catch(() => false)), id: modIdOf(meta) }
  if (key) localCache.set(jar, { key, info })
  return info
}

// 받은 jar 경로 중 서버에 넣으면 안 되는 것과 그 이유
// online=false: Modrinth에 묻지 않고 jar 안만 본다 (서버 켜기 전 점검처럼 빨라야 할 때)
export async function checkJars(jars: string[], online = true): Promise<Map<string, OffReason>> {
  const out = new Map<string, OffReason>()
  const infos = new Map<string, LocalInfo>()
  for (const jar of jars) {
    const info = await localInfo(jar)
    infos.set(jar, info)
    if (info.client) out.set(jar, 'client')
  }
  const rest = jars.filter((j) => !out.has(j))
  if (rest.length && online) {
    try {
      const bySha = new Map(rest.map((j) => [crypto.createHash('sha1').update(fs.readFileSync(j)).digest('hex'), j]))
      const versions = await modrinth.versionsByHash([...bySha.keys()])
      const projects = new Map((await modrinth.getProjects([...new Set([...versions.values()].map((v) => v.projectId))])).map((p) => [p.projectId, p]))
      for (const [sha, v] of versions) if (projects.get(v.projectId)?.serverSide === 'unsupported') out.set(bySha.get(sha)!, 'client')
    } catch {
      // 인터넷이 안 되면 jar 정보만으로 판단한다
    }
  }
  for (const jar of jars) if (!out.has(jar) && infos.get(jar)?.clientMixin) out.set(jar, 'clientMixin')
  return out
}

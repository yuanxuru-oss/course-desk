import { useMemo, useRef, useState } from 'react'
import { db } from '../db'
import {
  Upload,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Zap,
  Check,
  AlertTriangle,
  Sparkles,
} from 'lucide-react'
import type { Course, Settings } from '../types'
import { Card, Button, Badge, Empty, Field, Input, Select, Textarea, Tabs, Eyebrow } from './ui'
import { parseExcel, parsePlainText, toCourses, dedupeCourses, mergeAdjacentWeekSegments, courseSignature, type ImportedCourse , parseTable, type ImportResult } from '../lib/import'
import { parseCourse, parseHomework } from '../lib/nl'
import { extractPdf, recognizeImage } from '../lib/notify'
import { upsertCourse, upsertHomework, upsertNote, uploadImage, importCourses } from '../lib/actions'
import { WEEKDAY_CN } from '../lib/time'
import { cn } from '../lib/utils'

interface Props {
  settings: Settings
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void
  onDone: () => void
}

type Tab = 'file' | 'text'

export function ImportView({ settings, onToast, onDone }: Props) {
  const [tab, setTab] = useState<Tab>('file')
  const [parsed, setParsed] = useState<ImportedCourse[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [warnings, setWarnings] = useState<string[]>([])
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  /** 库里已有课程的内容签名:用来在预览里标「已存在」 */
  const [existingSigs, setExistingSigs] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)

  /** 只解析,不改 state —— 多文件/多页要先把结果攒齐再一次性写入 */
  const parseOne = async (f: File): Promise<ImportResult> => {
    const name = f.name.toLowerCase()
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
      return parseExcel(f)
    }
    if (name.endsWith('.pdf')) {
      /*
       * 三种 PDF 按优先级往下退:
       *   1. 有表格线 → 按真实格子还原(格子窄、文字逐字折行的课表只能靠这个)
       *   2. 没线但文字按网格排 → 按坐标还原成二维表,走 Excel 同款矩阵解析
       *   3. 都不行 → 按行拼文本
       * 每一页的结果都合并进来(之前只取「课程最多的一页」,多页课表会丢页)。
       */
      const { text, tables, gridCourses } = await extractPdf(f)
      const merged: ImportResult = { courses: [], warnings: [], unmatched: [] }

      if (gridCourses.length) {
        merged.courses.push(...gridCourses)
        merged.warnings.push(
          `按表格线还原出 ${gridCourses.length} 门课(格子里的课程名/教师/教室/周次已按格子拼回)`,
        )
      }
      tables.forEach((rows, i) => {
        const r = parseTable(rows, `PDF 第 ${i + 1} 页`)
        merged.courses.push(...r.courses)
        merged.warnings.push(...r.warnings)
        merged.unmatched.push(...r.unmatched)
      })

      if (merged.courses.length) {
        const dup = merged.courses.length - dedupeCourses(merged.courses).length
        merged.courses = dedupeCourses(merged.courses)
        if (dup > 0) merged.warnings.push(`已自动去掉 ${dup} 门重复课程`)
        if (tables.length > 1) merged.warnings.push(`已从 ${tables.length} 页 PDF 合并`)
        return merged
      }

      if (!text.trim()) {
        return {
          courses: [],
          warnings: [
            '这个 PDF 里没有文字层(多半是扫描件/图片拼的 PDF),提取不到任何文字。',
            '请改用「截图 OCR」:把课表截图存成图片,拖进来就能认。',
          ],
          unmatched: [],
        }
      }
      const r = parsePlainText(text)
      return {
        ...r,
        warnings: [
          ...r.warnings,
          ...(tables.length
            ? ['已从 PDF 还原出表格结构,但没认出课程,可试试截图 OCR']
            : ['这个 PDF 里没还原出表格结构,已按纯文本解析']),
          ...tables.map((_, i) => `已从 PDF 还原出第 ${i + 1} 页的表格结构`),
        ],
      }
    }
    if (f.type.startsWith('image/')) {
      const text = await recognizeImage(f, settings.ocrLang, (p) =>
        onToast(`识别中 ${Math.round(p * 100)}%`, 'info'),
      )
      return parsePlainText(text)
    }
    const text = await f.text()
    return parsePlainText(text)
  }

  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    setWarnings([])
    setUnmatched([])
    setParsed([])
    setSelected(new Set())
    const all: ImportResult = { courses: [], warnings: [], unmatched: [] }
    try {
      /*
       * 多选/多拖的文件要**全部**导入。
       * 原来循环里每轮都清空 state,最后只剩最后一个文件的结果。
       */
      for (const f of files) {
        const r = await parseOne(f)
        all.courses.push(...r.courses)
        all.warnings.push(...r.warnings.map((w) => (files.length > 1 ? `${f.name}:${w}` : w)))
        all.unmatched.push(...r.unmatched)
      }
      // 同一份文件导入两次会产生整份重复,按「课程名+星期+节次」去重
      const deduped = dedupeCourses(all.courses)
      const dup = all.courses.length - deduped.length
      // 同一门课被原表按周次拆成多段的,合并回一条(教师变化进备注)
      const courses = mergeAdjacentWeekSegments(deduped)
      const mergedCount = deduped.length - courses.length
      const warnings = [...all.warnings]
      if (dup > 0) warnings.push(`已自动去掉 ${dup} 门重复课程`)
      if (mergedCount > 0) warnings.push(`把同一门课被拆开的周次合并了 ${mergedCount} 处(教师变化写进备注)`)

      /*
       * 和库里已有的课做一次比对:完全一样的不再重复录入,
       * 默认不勾选,并在列表里标「已存在」。
       */
      const existing = await db.courses.toArray()
      const existSigs = new Set(existing.map((c) => courseSignature(c)))
      setExistingSigs(existSigs)
      const freshIdx = courses.map((_, i) => i).filter((i) => !existSigs.has(courseSignature(courses[i])))
      const already = courses.length - freshIdx.length
      if (already > 0) warnings.push(`其中 ${already} 门已经在课表里,已默认不勾选`)

      setParsed(courses)
      setSelected(new Set(freshIdx))
      setWarnings(warnings)
      setUnmatched(all.unmatched.slice(0, 20))
      if (courses.length) {
        onToast(`解析出 ${courses.length} 门课,确认后导入`, 'success')
      } else {
        onToast('没解析出课程,试试「一句话录入」', 'error')
      }
    } catch (err: any) {
      onToast(`解析失败:${err?.message ?? err}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const doImport = async () => {
    const picked = parsed.filter((_, i) => selected.has(i))
    if (!picked.length) {
      // 常见情况:这份课表已经导过了,预览里全被标成「已存在」且默认不勾选
      onToast(
        parsed.length ? '选中的课程都已经在课表里了,没有需要导入的' : '还没有解析出课程',
        'info',
      )
      return
    }
    /*
     * 走 importCourses:它按「内容签名」判重 ——
     * 库里已经有一模一样的课就跳过,不会再插入第二条。
     */
    const res = await importCourses(toCourses(picked))
    const parts = [
      res.added ? `新增 ${res.added} 门` : '',
      res.updated ? `更新 ${res.updated} 门` : '',
      res.skipped ? `跳过 ${res.skipped} 门(已存在)` : '',
    ].filter(Boolean)
    onToast(parts.length ? parts.join(',') : '没有需要导入的课程', res.skipped && !res.added ? 'info' : 'success')
    setParsed([])
    setSelected(new Set())
    onDone()
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <Eyebrow tone="butter">工具</Eyebrow>
        </div>
        <h1 className="page-title">导入课表</h1>
        <p className="page-sub">从教务系统导出文件导入,或者直接用一句话描述课程</p>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'file', label: '文件导入' },
          { value: 'text', label: '一句话录入' },
        ]}
      />

      {tab === 'file' && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const files = Array.from(e.dataTransfer.files)
              if (files.length) handleFiles(files)
            }}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors',
              dragOver ? 'border-tangerine-500 bg-tangerine-50' : 'border-ink/[0.15] bg-white hover:border-tangerine-400',
            )}
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.csv,.pdf,image/*"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length) handleFiles(files)
                e.target.value = ''
              }}
            />
            <div className="w-12 h-12 rounded-2xl bg-tangerine-50 text-tangerine-600 grid place-items-center mx-auto mb-3">
              <Upload size={22} />
            </div>
            <p className="text-[15px] font-medium text-ink">把教务系统导出的文件拖进来</p>
            <p className="text-[13px] text-ink-soft mt-1.5">支持 Excel / CSV / PDF / 课表截图</p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              <Badge>
                <FileSpreadsheet size={11} /> Excel
              </Badge>
              <Badge>
                <FileText size={11} /> PDF
              </Badge>
              <Badge>
                <ImageIcon size={11} /> 截图 OCR
              </Badge>
            </div>
            {busy && <p className="text-[13px] text-tangerine-600 mt-3">正在解析…</p>}
          </div>

          <div className="rounded-xl bg-butter-100/70 p-3.5 text-[12.5px] text-ink-soft leading-relaxed">
            <div className="font-medium text-ink-soft mb-1">怎么导出?</div>
            登录教务系统 → 课表查询 → 导出课表(Excel 优先,PDF 次之)。表头不用整理,程序会按常见教务系统的列名自动识别
            「课程名称 / 教师 / 教室 / 星期 / 节次 / 周次」,也支持「星期 × 节次」矩阵式课表。
          </div>

          {warnings.length > 0 && (
            <div className="rounded-xl bg-butter-100 border border-ink/10 p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <AlertTriangle size={14} className="text-tangerine-600" />
                <span className="text-[13px] font-semibold text-ink">解析提示</span>
              </div>
              <ul className="space-y-1">
                {warnings.map((w, i) => (
                  <li key={i} className="text-[12.5px] text-ink-soft">
                    · {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {parsed.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b border-ink/[0.08] flex items-center gap-3">
                <h3 className="font-semibold text-ink text-[14px]">
                  解析结果 <span className="text-ink-mute font-normal">({selected.size}/{parsed.length})</span>
                </h3>
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected(new Set(parsed.map((_, i) => i)))}
                  >
                    全选
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    全不选
                  </Button>
                  <Button size="sm" variant="primary" onClick={doImport}>
                    确认导入
                  </Button>
                </div>
              </div>
              <div className="divide-y-2 divide-ink/[0.06]">
                {parsed.map((c, i) => (
                  <button
                    key={i}
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (next.has(i)) next.delete(i)
                        else next.add(i)
                        return next
                      })
                    }
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-butter-50 transition-colors"
                  >
                    <span
                      className={cn(
                        'w-5 h-5 rounded-md border grid place-items-center shrink-0 transition-colors',
                        selected.has(i) ? 'bg-tangerine-500 border-tangerine-600 text-white' : 'border-ink/[0.15]',
                      )}
                    >
                      {selected.has(i) && <Check size={13} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13.5px] font-medium text-ink truncate">{c.name}</span>
                        {existingSigs.has(courseSignature(c)) && (
                          <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-butter-200 text-ink-soft">
                            已存在
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-mute truncate">
                        星期{WEEKDAY_CN[c.weekday - 1]} 第{c.period}
                        {c.periods > 1 ? `-${c.period + c.periods - 1}` : ''}节 ·{' '}
                        {c.startWeek === c.endWeek ? `第${c.startWeek}周` : `第${c.startWeek}-${c.endWeek}周`}
                        {c.singleWeeks?.length ? '(单双周)' : ''}
                        {c.teacher ? ` · ${c.teacher}` : ''}
                        {c.location ? ` · ${c.location}` : ''}
                      </div>
                      {c.remark && (
                        <div className="text-[10.5px] text-tangerine-700 truncate mt-0.5">{c.remark}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {unmatched.length > 0 && (
            <details className="rounded-xl bg-butter-100/70 p-3.5 text-[12px] text-ink-soft">
              <summary className="cursor-pointer font-medium text-ink-soft">
                有 {unmatched.length} 行没能解析(点开查看)
              </summary>
              <ul className="mt-2 space-y-1">
                {unmatched.map((u, i) => (
                  <li key={i}>· {u}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {tab === 'text' && <TextImporter settings={settings} onToast={onToast} onDone={onDone} />}
    </div>
  )
}

/* ---------------- 一句话录入 ---------------- */
function TextImporter({
  settings,
  onToast,
  onDone,
}: {
  settings: Settings
  onToast: (t: string, type?: 'info' | 'success' | 'error') => void
  onDone: () => void
}) {
  const [mode, setMode] = useState<'course' | 'homework' | 'note'>('course')
  const [text, setText] = useState('')
  const [parsedCourse, setParsedCourse] = useState<ReturnType<typeof parseCourse>>(null)
  const [parsedHw, setParsedHw] = useState<ReturnType<typeof parseHomework>>(null)
  const [name, setName] = useState('')
  const [weekday, setWeekday] = useState(1)
  const [period, setPeriod] = useState(1)
  const [periods, setPeriods] = useState(1)
  const [location, setLocation] = useState('')
  const [teacher, setTeacher] = useState('')
  const [startWeek, setStartWeek] = useState(1)
  const [endWeek, setEndWeek] = useState(16)

  const examples = [
    '周三下午3点高等数学 教三302',
    '周一1-2节大学英语 一教201',
    '周五 15:00-16:45 线性代数 教二305',
    '周四 3-4节 体育(体育馆)',
  ]

  const doParse = () => {
    if (!text.trim()) return
    if (mode === 'course') {
      const p = parseCourse(text, { startWeek: 1, endWeek: settings.weekCount })
      if (!p) {
        onToast('没能解析出课程,换个说法试试', 'error')
        return
      }
      setParsedCourse(p)
      setParsedHw(null)
      setName(p.name)
      setWeekday(p.weekday)
      setPeriod(p.period)
      setPeriods(p.periods)
      setLocation(p.location ?? '')
      setTeacher(p.teacher ?? '')
      setStartWeek(p.startWeek)
      setEndWeek(p.endWeek)
    } else if (mode === 'homework') {
      const p = parseHomework(text, { startWeek: 1, endWeek: settings.weekCount })
      if (!p) {
        onToast('没能解析出作业信息', 'error')
        return
      }
      setParsedHw(p)
      setParsedCourse(null)
      setName(p.title)
    } else {
      setParsedCourse(null)
      setParsedHw(null)
    }
  }

  const save = async () => {
    if (mode === 'course') {
      if (!name.trim()) return
      // 同样走判重:同一门课重复录入不会变成两条
      const res = await importCourses(
        toCourses([
          {
            name: name.trim(),
            weekday,
            period,
            periods,
            location: location.trim() || undefined,
            teacher: teacher.trim() || undefined,
            startWeek,
            endWeek,
          },
        ]),
      )
      onToast(res.added ? '课程已添加' : '这门课已经在课表里了', res.added ? 'success' : 'info')
      setText('')
      setParsedCourse(null)
      onDone()
    } else if (mode === 'homework') {
      if (!name.trim()) return
      const w = parsedHw?.weekday ?? weekday
      const time = parsedHw?.timeOfDay ?? '23:59'
      const [hh, mm] = time.split(':').map(Number)
      const due = new Date()
      due.setDate(due.getDate() + ((w - due.getDay() + 7) % 7 === 0 ? 7 : (w - due.getDay() + 7) % 7))
      due.setHours(hh, mm, 0, 0)
      await upsertHomework({ title: name.trim(), dueAt: due.getTime(), detail: text.trim() })
      onToast('作业已添加', 'success')
      setText('')
      setParsedHw(null)
    } else {
      if (!text.trim()) return
      await upsertNote({ title: name.trim() || text.slice(0, 20), content: text })
      onToast('备忘已保存', 'success')
      setText('')
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <div className="space-y-3">
        <Card className="p-4 space-y-3">
          <div className="flex gap-1.5">
            {(
              [
                { k: 'course', l: '加课程' },
                { k: 'homework', l: '加作业' },
                { k: 'note', l: '加备忘' },
              ] as const
            ).map((m) => (
              <button
                key={m.k}
                onClick={() => {
                  // 切模式时把上一次解析出来的名字清掉,
                  // 否则「加备忘」会沿用上一门课程的名字当笔记标题
                  setMode(m.k)
                  setName('')
                  setParsedCourse(null)
                  setParsedHw(null)
                }}
                className={cn(
                  'px-3 h-8 rounded-lg text-[13px] font-medium transition-colors',
                  mode === m.k ? 'bg-tangerine-500 text-white' : 'bg-butter-100 text-ink-soft hover:bg-butter-200',
                )}
              >
                {m.l}
              </button>
            ))}
          </div>
          <Textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === 'course'
                ? '例:周三下午3点高等数学 教三302'
                : mode === 'homework'
                  ? '例:每周五交高数周记'
                  : '直接写要记的内容'
            }
          />
          <div className="flex gap-2">
            <Button variant="primary" onClick={doParse} disabled={!text.trim()}>
              <Zap size={15} /> 智能解析
            </Button>
            {mode === 'note' && (
              <Button variant="secondary" onClick={save} disabled={!text.trim()}>
                直接保存
              </Button>
            )}
          </div>
        </Card>

        {mode === 'course' && (
          <Card className="p-4">
            <div className="text-[13px] font-medium text-ink-soft mb-2.5">试试这些说法</div>
            <div className="space-y-1.5">
              {examples.map((e) => (
                <button
                  key={e}
                  onClick={() => setText(e)}
                  className="w-full text-left px-2.5 py-2 rounded-lg bg-butter-50 hover:bg-tangerine-50 text-[12.5px] text-ink-soft transition-colors font-mono"
                >
                  {e}
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>

      <Card className="p-4 space-y-3.5">
        {(mode === 'course' && parsedCourse) || (mode === 'homework' && parsedHw) ? (
          <>
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-tangerine-600" />
              <span className="text-[14px] font-semibold text-ink">解析结果</span>
              <Badge color="#3b66f6">可修改</Badge>
            </div>

            {parsedCourse?.notes?.length ? (
              <div className="rounded-lg bg-butter-100 border border-ink/10 px-3 py-2 text-[12px] text-ink-soft">
                {parsedCourse.notes.map((n, i) => (
                  <div key={i}>· {n}</div>
                ))}
              </div>
            ) : null}
            {parsedHw?.notes?.length ? (
              <div className="rounded-lg bg-butter-100 border border-ink/10 px-3 py-2 text-[12px] text-ink-soft">
                {parsedHw.notes.map((n, i) => (
                  <div key={i}>· {n}</div>
                ))}
              </div>
            ) : null}

            <Field label="名称">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>

            {mode === 'course' && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="星期">
                    <Select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                      {WEEKDAY_CN.map((w, i) => (
                        <option key={w} value={i + 1}>
                          星期{w}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="节次">
                    <Select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
                      {settings.periods.map((p) => (
                        <option key={p.index} value={p.index}>
                          第{p.index}节
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="连堂">
                    <Select value={periods} onChange={(e) => setPeriods(Number(e.target.value))}>
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n}节
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="教室">
                    <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="教三302" />
                  </Field>
                  <Field label="教师">
                    <Input value={teacher} onChange={(e) => setTeacher(e.target.value)} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="起始周">
                    <Input type="number" min={1} value={startWeek} onChange={(e) => setStartWeek(Number(e.target.value))} />
                  </Field>
                  <Field label="结束周">
                    <Input type="number" min={1} value={endWeek} onChange={(e) => setEndWeek(Number(e.target.value))} />
                  </Field>
                </div>
              </>
            )}

            {mode === 'homework' && parsedHw && (
              <div className="rounded-lg bg-butter-50 px-3 py-2 text-[12.5px] text-ink-soft">
                截止时间按「{parsedHw.timeOfDay},每周{WEEKDAY_CN[parsedHw.weekday - 1]}」推算
              </div>
            )}

            <Button variant="primary" onClick={save} className="w-full">
              <Check size={15} /> 确认添加
            </Button>
          </>
        ) : (
          <Empty
            icon={<Zap size={28} />}
            title="左边输入一句话"
            description="程序会识别星期、节次、教室和周次,解析结果可以再修改"
          />
        )}
      </Card>
    </div>
  )
}

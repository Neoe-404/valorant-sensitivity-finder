"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Crosshair, MousePointerClick, FlaskConical, LineChart, ShieldAlert, ArrowRight, Radar } from "lucide-react";

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-10%] h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.25]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse 90% 60% at 50% 30%, black, transparent)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        {/* ===== Hero ===== */}
        <section className="flex min-h-[72vh] flex-col items-center justify-center py-20 text-center">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="chip mb-8"
          >
            <Radar size={13} className="text-accent" />
            Personal Optimization Tool · 不是 eDPI 计算器
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl"
          >
            找到真正适合你的
            <br />
            VALORANT 灵敏度
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mt-6 max-w-xl text-base text-dim sm:text-lg"
          >
            不是复制职业选手参数。
            <br className="hidden sm:block" />
            通过你的实际鼠标控制表现寻找答案。
          </motion.p>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="mt-2 font-mono text-xs text-dim"
          >
            Pointer Lock · movementX/Y · Virtual Sensitivity Multiplier
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-4"
          >
            <Link href="/setup" className="btn-primary text-base">
              <Crosshair size={16} />
              Find My Sensitivity
            </Link>
            <a href="#how" className="btn-ghost">
              查看原理
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.45 }}
            className="mt-14 flex items-center gap-6 font-mono text-[11px] uppercase tracking-widest text-dim/70"
          >
            <span>Flick Test</span>
            <span className="text-accent">·</span>
            <span>Tracking Test</span>
            <span className="text-accent">·</span>
            <span>Micro Adjustment</span>
          </motion.div>
        </section>

        {/* ===== How It Works ===== */}
        <section id="how" className="py-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
          >
            <h2 className="text-4xl font-bold tracking-tight">Sensitivity is Personal.</h2>
            <p className="mt-2 text-dim">每个人的灵敏度都应该不同。三步找出你的答案。</p>
          </motion.div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: MousePointerClick,
                title: "Test",
                cn: "建立基线",
                desc: "Pointer Lock 捕获你真实的鼠标移动，完成 Flick、Tracking、Micro 三个专项测试。",
              },
              {
                icon: FlaskConical,
                title: "Compare",
                cn: "对比候选",
                desc: "虚拟灵敏度倍率模拟 0.8× / 1.0× / 1.2×……多轮候选横向对比你的真实表现。",
              },
              {
                icon: LineChart,
                title: "Optimize",
                cn: "收敛推荐",
                desc: "搜索算法逐轮缩小范围，输出推荐灵敏度、区间、eDPI 与置信度。",
              },
            ].map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12 }}
                className="panel group relative overflow-hidden p-6 transition hover:border-accent/40"
              >
                <div className="absolute right-0 top-0 h-24 w-24 -translate-y-1/2 translate-x-1/2 rounded-full bg-accent/10 blur-2xl transition group-hover:bg-accent/20" />
                <s.icon size={22} className="text-accent" />
                <div className="mt-4 text-lg font-semibold">
                  {s.title} <span className="ml-1 text-sm font-normal text-dim">{s.cn}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-dim">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ===== Result Demo ===== */}
        <section className="py-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            className="panel relative overflow-hidden p-8 sm:p-10"
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-accent/60 to-transparent" />
            <div className="flex flex-wrap items-center justify-between gap-8">
              <div>
                <div className="chip mb-4">
                  示例演示数据 · 每位玩家的结果都来自自己的测试
                </div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-dim">Your Sensitivity</div>
                <div className="mt-1 font-mono text-6xl font-bold text-fg">0.325</div>
                <div className="mt-4 flex gap-2 font-mono text-sm text-dim">
                  <span className="rounded border border-line bg-panel-2 px-2 py-1">DPI 800</span>
                  <span className="rounded border border-line bg-panel-2 px-2 py-1">eDPI 260</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-widest text-dim">Recommended Range</div>
                <div className="mt-1 font-mono text-2xl text-fg">0.30 ~ 0.35</div>
                <div className="mt-4 inline-flex items-center gap-1.5 text-sm text-good">
                  <span className="h-1.5 w-1.5 rounded-full bg-good" />
                  Confidence · High (82%)
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* ===== Why not copy pro settings ===== */}
        <section className="py-16 pb-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-3xl"
          >
            <div className="flex items-center gap-3">
              <ShieldAlert size={20} className="text-warn" />
              <h2 className="text-2xl font-bold tracking-tight">Why not copy pro settings?</h2>
            </div>
            <p className="mt-4 leading-relaxed text-dim">
              每个职业选手的灵敏度都建立在自己的鼠标历史与肌肉记忆上。直接复制别人的参数，
              等于让一个左撇子用右手玩家的设置。本工具不查询任何职业选手数据库 ——
              它通过
              <span className="text-fg"> 你自己的鼠标移动数据</span>
              ，找到你在五种灵敏度模拟条件下表现最优的那个区间。
            </p>
            <p className="mt-4 text-xs leading-relaxed text-dim/80">
              技术说明：网页无法修改 Windows / 游戏内的真实灵敏度。本工具使用 Pointer Lock 读取
              movementX/Y，通过 Virtual Sensitivity Multiplier 模拟不同灵敏度的相对控制体验，
              属于灵敏度推荐工具，而非物理级输入校准设备。
            </p>
            <Link href="/setup" className="btn-primary mt-8">
              开始测试 <ArrowRight size={16} />
            </Link>
          </motion.div>
        </section>
      </div>
    </main>
  );
}

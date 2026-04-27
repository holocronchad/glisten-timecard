import { motion, useInView } from 'framer-motion';
import { useRef, ReactNode } from 'react';

type Word = { text: string; className?: string };

export function WordsPullUp({
  words,
  className = '',
  delay = 0,
}: {
  words: Word[];
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10%' });

  return (
    <div ref={ref} className={`flex flex-wrap gap-x-[0.25em] ${className}`}>
      {words.map((w, i) => (
        <motion.span
          key={i}
          initial={{ y: '110%', opacity: 0 }}
          animate={inView ? { y: 0, opacity: 1 } : {}}
          transition={{
            duration: 0.7,
            delay: delay + i * 0.06,
            ease: [0.22, 0.61, 0.36, 1],
          }}
          className={`inline-block leading-[1.05] ${w.className ?? ''}`}
        >
          {w.text}
        </motion.span>
      ))}
    </div>
  );
}

export function FadeUp({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, delay, ease: [0.22, 0.61, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

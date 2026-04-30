// Shared punch-type display: label + color class. Used everywhere a punch
// type is rendered (manager tables, kiosk buttons, /me history, modals)
// so the green-clock-in / maroon-clock-out convention is consistent.
//
// Per Dr. Dawood 2026-04-29 — Dr. Dawood was getting confused because
// every type read in the same neutral creamSoft tone in tables.

import type { PunchType } from './api';

export const PUNCH_LABEL: Record<PunchType, string> = {
  clock_in: 'Clock in',
  clock_out: 'Clock out',
  lunch_start: 'Lunch start',
  lunch_end: 'Lunch end',
};

// Tailwind class for the LABEL TEXT itself.
export function punchTextClass(type: PunchType): string {
  switch (type) {
    case 'clock_in':
      return 'text-clockIn';
    case 'clock_out':
      return 'text-clockOut';
    case 'lunch_start':
    case 'lunch_end':
      return 'text-lunchAccent';
  }
}

// Tailwind class for a small leading dot.
export function punchDotClass(type: PunchType): string {
  switch (type) {
    case 'clock_in':
      return 'bg-clockIn';
    case 'clock_out':
      return 'bg-clockOut';
    case 'lunch_start':
    case 'lunch_end':
      return 'bg-lunchAccent';
  }
}

// Hex color (for SVG icons / canvas / PDF if ever needed).
export function punchHex(type: PunchType): string {
  switch (type) {
    case 'clock_in':
      return '#7CB382';
    case 'clock_out':
      return '#B5462E';
    case 'lunch_start':
    case 'lunch_end':
      return '#C9A961';
  }
}

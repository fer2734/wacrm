import { expect,it } from 'vitest';
import {dayKey,monthDays,moveToDay} from './dates';
it('builds six full weeks starting on Monday, including year boundaries',()=>{const days=monthDays(new Date(2027,0,1));expect(days).toHaveLength(42);expect(days[0].getDay()).toBe(1);expect(days.map(dayKey)).toContain('2027-01-01');expect(new Set(days.map(dayKey)).size).toBe(42)});
it('moving a task preserves its local time',()=>{const before=new Date(2026,10,17,15,45);const after=new Date(moveToDay(before.toISOString(),'2026-12-02'));expect(dayKey(after)).toBe('2026-12-02');expect(after.getHours()).toBe(15);expect(after.getMinutes()).toBe(45)});

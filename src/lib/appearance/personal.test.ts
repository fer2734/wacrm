import {expect,it} from 'vitest';
import {foreground,normalizePersonalStyle} from './personal';
it('rejects CSS injection and invalid font sizes',()=>{expect(normalizePersonalStyle({fontSize:999,accent:'red;url(x)',background:'javascript:'})).toEqual({fontSize:16,accent:null,background:null})});
it('chooses contrasting text',()=>{expect(foreground('#ffffff')).toBe('#000000');expect(foreground('#000000')).toBe('#ffffff')});

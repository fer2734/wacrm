import { describe, it, expect } from 'vitest';
import { readPhotoResponse, validateProfilePhoto } from './profile-photo-response';
describe('profile photo upload response', () => {
  it('never displays raw HTML or a JSON parser exception', async () => {
    await expect(readPhotoResponse(new Response('<!DOCTYPE html><h1>Bad gateway</h1>', {status:502}))).rejects.toThrow('HTTP 502');
  });
  it('explains upload limits even when the proxy sends HTML', async () => {
    await expect(readPhotoResponse(new Response('<html>too large</html>', {status:413}))).rejects.toThrow('tamaño');
  });
  it('preserves structured Meta rejection and confirmed success', async () => {
    expect(await readPhotoResponse(Response.json({error:'Meta rechazó la imagen'}, {status:502}))).toEqual({success:false,error:'Meta rechazó la imagen'});
    expect(await readPhotoResponse(Response.json({success:true}))).toMatchObject({success:true});
  });
  it('does not treat HTML 200 or empty responses as success', async () => {
    await expect(readPhotoResponse(new Response('<!DOCTYPE html>'))).rejects.toThrow('no confirmó');
    await expect(readPhotoResponse(new Response(''))).rejects.toThrow('no confirmó');
  });
  it('validates size and media type before starting upload', () => {
    expect(validateProfilePhoto({type:'image/png',size:5*1024*1024})).toBeNull();
    expect(validateProfilePhoto({type:'image/png',size:5*1024*1024+1})).toContain('5 MB');
    expect(validateProfilePhoto({type:'image/gif',size:100})).toContain('JPG o PNG');
    expect(validateProfilePhoto({type:'image/png',size:0})).toContain('vacía');
  });
});

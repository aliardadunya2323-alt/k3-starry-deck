// Selectable F-01 costume intent, applied to current rigs rather than old heads.
export const OUTFIT_STORAGE_KEY = 'k3-3d-outfit';
export const OUTFIT_LABELS = Object.freeze({ voyager: '夜航披风', light: '黑白轻装' });
const valid = key => key === 'voyager' || key === 'light';
export function readOutfitPreference(storage) {
  try { const key = storage?.getItem(OUTFIT_STORAGE_KEY); return valid(key) ? key : 'voyager'; }
  catch (_) { return 'voyager'; }
}
export function writeOutfitPreference(storage, key) {
  if (!valid(key) || !storage) return false;
  try { storage.setItem(OUTFIT_STORAGE_KEY, key); return storage.getItem(OUTFIT_STORAGE_KEY) === key; }
  catch (_) { return false; }
}

export function createOutfitController(rigs) {
  const forms = ['chibi', 'awakened'];
  const snapshots = forms.map(form => {
    const rig = rigs[form], parts = rig?.outfitParts;
    if (!parts?.top?.color || !parts.bottom?.color || !parts.pelvis || !rig.cloak || !rig.cloakDims) {
      throw new Error('Current character outfit bindings are incomplete: ' + form);
    }
    return { form, rig, parts, top: parts.top.color.getHex(), bottom: parts.bottom.color.getHex(),
      pelvisMaterial: parts.pelvis.material, hoodVisible: parts.hood?.visible,
      dims: { ...rig.cloakDims }, scaleX: rig.cloak.scale.x, innerScaleX: rig.cloakInner?.scale.x };
  });
  let current = 'voyager';
  function set(key) {
    if (!valid(key) || key === current) return false;
    const light = key === 'light';
    for (const s of snapshots) {
      const { rig, parts, form } = s;
      parts.top.color.setHex(light ? 0x45465a : s.top);
      // Awakened's current continuous trousers already use this white material.
      // Keep them untouched: their authored mesh has its own cloned cloth shader.
      if (form === 'chibi') {
        parts.bottom.color.setHex(light ? 0xd9d9e6 : s.bottom);
        parts.pelvis.material = light ? parts.bottom : s.pelvisMaterial;
        if (parts.hood) parts.hood.visible = light ? false : s.hoodVisible;
      }
      Object.assign(rig.cloakDims, light ? {
        yHem: form === 'chibi' ? -0.2 : -0.36,
        r1: 0.3,
        flareScale: form === 'chibi' ? 1 : 1.3,
        wave: form === 'chibi' ? 0.02 : 0.04,
      } : s.dims);
      rig.cloak.scale.x = light ? (form === 'chibi' ? 1.08 : 1.12) : s.scaleX;
      if (rig.cloakInner) rig.cloakInner.scale.x = light ? 1.12 : s.innerScaleX;
    }
    current = key;
    return true;
  }
  return { set, get current() { return current; } };
}

import QRCode from 'qrcode';

const OPTS = { errorCorrectionLevel: 'M', margin: 1, color: { dark: '#000000', light: '#ffffff' } };

export function qrSvg(text, { size = 512 } = {}) {
  return QRCode.toString(text, { ...OPTS, type: 'svg', width: size });
}

export function qrPngBuffer(text, { size = 512 } = {}) {
  return QRCode.toBuffer(text, { ...OPTS, type: 'png', width: size });
}

export function qrDataUrl(text, { size = 512 } = {}) {
  return QRCode.toDataURL(text, { ...OPTS, width: size });
}

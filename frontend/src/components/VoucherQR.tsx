import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Código QR del voucher (voucher_qr_data del contrato v2) para el retiro en mostrador. */
export default function VoucherQR({ data, size = 168, titulo = 'Voucher QR' }: { data: string; size?: number; titulo?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(data, { width: size, margin: 1, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc(''));
  }, [data, size]);
  return (
    <figure style={{ margin: 0, textAlign: 'center' }}>
      {src
        ? <img src={src} width={size} height={size} alt={`${titulo}: ${data}`} style={{ background: '#fff', borderRadius: 8, padding: 4 }} />
        : <div style={{ width: size, height: size }} aria-hidden="true" />}
      <figcaption className="text-muted" style={{ fontSize: '0.7rem', marginTop: 4, wordBreak: 'break-all' }}>
        <code>{data}</code>
      </figcaption>
    </figure>
  );
}

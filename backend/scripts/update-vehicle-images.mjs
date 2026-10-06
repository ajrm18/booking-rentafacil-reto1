/**
 * Actualiza las fotos de los vehiculos del seed en una BD ya poblada (p. ej. produccion),
 * usando PUT /admin/vehicles/:id con `gallery`. Idempotente: se puede correr varias veces.
 *
 *   node backend/scripts/update-vehicle-images.mjs [API_BASE]
 */
const API = process.argv[2] || 'https://rentafacil-api.onrender.com/api/v1';

const GALERIAS = {
  "VEH-1001": [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Chevrolet_Sail_1.5_LT_2016.jpg/1280px-Chevrolet_Sail_1.5_LT_2016.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Chevrolet_Sail_1.5_LTZ_2024_%2853384018077%29.jpg/1280px-Chevrolet_Sail_1.5_LTZ_2024_%2853384018077%29.jpg"
  ],
  "VEH-1002": [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Kia_Rio4_1.4_EX_sedan_2023.jpg/1280px-Kia_Rio4_1.4_EX_sedan_2023.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Kia_Rio4_1.4_EX_sedan_2018.jpg/1280px-Kia_Rio4_1.4_EX_sedan_2018.jpg"
  ],
  "VEH-1003": [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Toyota_Corolla_Hybrid_Sedan%2C_GIMS_2019%2C_Le_Grand-Saconnex_%28GIMS1338%29.jpg/1280px-Toyota_Corolla_Hybrid_Sedan%2C_GIMS_2019%2C_Le_Grand-Saconnex_%28GIMS1338%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Toyota_Corolla_sedan_E210_hydrid.jpg/1280px-Toyota_Corolla_sedan_E210_hydrid.jpg"
  ],
  "VEH-1004": [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Nissan_Sentra_%28B18%29_Washington_DC_Metro_Area%2C_USA.jpg/1280px-Nissan_Sentra_%28B18%29_Washington_DC_Metro_Area%2C_USA.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/2024_Nissan_Sentra_%28B18%29_DSC_3754.jpg/1280px-2024_Nissan_Sentra_%28B18%29_DSC_3754.jpg"
  ],
  "VEH-1005": [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Hyundai_Tucson_%28NX4%29_1X7A0424.jpg/1280px-Hyundai_Tucson_%28NX4%29_1X7A0424.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/HYUNDAI_TUCSON_%28NX4%29_China.jpg/1280px-HYUNDAI_TUCSON_%28NX4%29_China.jpg"
  ],
  "VEH-1006": [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/2021_Toyota_RAV4_PHV.jpg/1280px-2021_Toyota_RAV4_PHV.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Toyota_RAV4_Hybrid_%28XA50%29_DSC_2709.jpg/1280px-Toyota_RAV4_Hybrid_%28XA50%29_DSC_2709.jpg"
  ],
  "VEH-1007": [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Ford_Ranger_4x4_Wildtrak_2023_%2810%29.jpg/1280px-Ford_Ranger_4x4_Wildtrak_2023_%2810%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Ford_Ranger_4x4_Wildtrak_2023_%2811%29.jpg/1280px-Ford_Ranger_4x4_Wildtrak_2023_%2811%29.jpg"
  ],
  "VEH-1008": [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Chevrolet_D-Max_2008_3.5v6.jpg/1280px-Chevrolet_D-Max_2008_3.5v6.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/2016_Isuzu_D-Max_2.5_LT_4x2%2C_06-30-2024.jpg/1280px-2016_Isuzu_D-Max_2.5_LT_4x2%2C_06-30-2024.jpg"
  ],
  "VEH-1009": [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/BMW_G20_3_Series_Jet_Black_%281%29.jpg/1280px-BMW_G20_3_Series_Jet_Black_%281%29.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/BMW_330i_G20_M_Sport_2019.jpg/1280px-BMW_330i_G20_M_Sport_2019.jpg"
  ],
  "VEH-1010": [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Mercedes-Benz_C_200_AVANTGARDE_%28W206%29_front.jpg/1280px-Mercedes-Benz_C_200_AVANTGARDE_%28W206%29_front.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Mercedes-Benz_C_200_AVANTGARDE_%28W206%29.jpg/1280px-Mercedes-Benz_C_200_AVANTGARDE_%28W206%29.jpg"
  ]
};

const tokRes = await fetch(API + '/auth/token', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@rentafacil.ec', password: 'Admin12345' }),
  signal: AbortSignal.timeout(90000),
});
const { access_token } = await tokRes.json();
if (!access_token) { console.error('No se pudo obtener token', tokRes.status); process.exit(1); }

let fallos = 0;
for (const [id, gallery] of Object.entries(GALERIAS)) {
  const r = await fetch(`${API}/admin/vehicles/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ main_image_url: gallery[0], gallery }),
  });
  const j = await r.json().catch(() => ({}));
  const ok = r.ok && j.main_image_url === gallery[0] && (j.images || []).length === gallery.length;
  if (!ok) fallos++;
  console.log(ok ? '✔' : '✘', id, r.status, ok ? '' : JSON.stringify(j).slice(0, 200));
}
process.exit(fallos ? 1 : 0);

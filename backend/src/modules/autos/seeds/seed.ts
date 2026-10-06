import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { Depot } from '../entities/depot.entity';
import { Supplier } from '../entities/supplier.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { VehicleImage } from '../entities/vehicle-image.entity';
import { Order } from '../entities/order.entity';
import { User } from '../entities/user.entity';
import { hashPassword } from '../../../common/password';

/**
 * Carga datos iniciales para el reto 1: depots (agencias), suppliers (proveedores)
 * y vehicles con sus imagenes. Compatible con el contrato autos-openapi.yaml
 * (depot_id, supplier_id, vehicle_id en formato string tipo "VEH-1001").
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ds = app.get(DataSource);

  const depotRepo = ds.getRepository(Depot);
  const supplierRepo = ds.getRepository(Supplier);
  const vehicleRepo = ds.getRepository(Vehicle);
  const imgRepo = ds.getRepository(VehicleImage);

  console.log('Sembrando datos iniciales - GDS Autos Core API (RentaFacil EC)...');

  // Suppliers (Proveedores GDS)
  let suppliers: Supplier[] = await supplierRepo.find();
  if (suppliers.length === 0) {
    suppliers = await supplierRepo.save([
      supplierRepo.create({ name: 'RentaFacil Prime', brand: 'RENTAFACIL', description: 'Proveedor propio - flota premium' }),
      supplierRepo.create({ name: 'AndinaCars', brand: 'ANDINA', description: 'Proveedor asociado en la sierra' }),
      supplierRepo.create({ name: 'CostaMovil', brand: 'COSTA', description: 'Proveedor asociado en la costa' }),
    ]);
    console.log('  suppliers creados');
  }

  // Depots (Agencias)
  let depots: Depot[] = await depotRepo.find();
  if (depots.length === 0) {
    depots = await depotRepo.save([
      depotRepo.create({
        name: 'Agencia Quito Aeropuerto', city: 'Quito', address: 'Aeropuerto Mariscal Sucre, Tababela',
        airport: 'UIO', city_id: 1, latitude: -0.1292, longitude: -78.3575, score: 4.7,
      }),
      depotRepo.create({
        name: 'Agencia Quito Centro Norte', city: 'Quito', address: 'Av. Amazonas y Naciones Unidas',
        airport: null, city_id: 1, latitude: -0.1807, longitude: -78.4678, score: 4.5,
      }),
      depotRepo.create({
        name: 'Agencia Guayaquil Aeropuerto', city: 'Guayaquil',
        address: 'Aeropuerto José Joaquín de Olmedo',
        airport: 'GYE', city_id: 2, latitude: -2.1544, longitude: -79.8878, score: 4.6,
      }),
      depotRepo.create({
        name: 'Agencia Cuenca', city: 'Cuenca', address: 'Av. Solano y 12 de Abril',
        airport: null, city_id: 3, latitude: -2.9006, longitude: -79.0059, score: 4.4,
      }),
    ]);
    console.log('  depots creados');
  }

  // Vehicles
  if ((await vehicleRepo.count()) === 0) {
    const [rfPrime, andina, costa] = suppliers;
    const [uioAero, uioCentro, gye, cue] = depots;

    // Fotos reales de cada modelo (Wikimedia Commons, CC BY / CC BY-SA; créditos en frontend/src/data/photoCredits.ts)
    const catalogo = [
      { vehicle_id: 'VEH-1001', make: 'Chevrolet', model: 'Sail', year: 2023, plate: 'PBA-1001', color: 'Blanco',
        seats: 5, doors: 4, bag_capacity: 2, transmission: 'manual', fuel_type: 'gasolina', car_type: 'Compacto',
        price_per_day: 25.00, sup: rfPrime, dep: uioCentro,
        desc: 'Vehículo compacto, económico en combustible, ideal para la ciudad.',
        img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Chevrolet_Sail_1.5_LT_2016.jpg/1280px-Chevrolet_Sail_1.5_LT_2016.jpg',
        img2: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Chevrolet_Sail_1.5_LTZ_2024_%2853384018077%29.jpg/1280px-Chevrolet_Sail_1.5_LTZ_2024_%2853384018077%29.jpg' },
      { vehicle_id: 'VEH-1002', make: 'Kia', model: 'Rio', year: 2023, plate: 'PBA-1002', color: 'Rojo',
        seats: 5, doors: 4, bag_capacity: 2, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'Compacto',
        price_per_day: 30.00, sup: rfPrime, dep: uioAero,
        desc: 'Subcompacto moderno con transmisión automática.',
        img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Kia_Rio4_1.4_EX_sedan_2023.jpg/1280px-Kia_Rio4_1.4_EX_sedan_2023.jpg',
        img2: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Kia_Rio4_1.4_EX_sedan_2018.jpg/1280px-Kia_Rio4_1.4_EX_sedan_2018.jpg' },
      { vehicle_id: 'VEH-1003', make: 'Toyota', model: 'Corolla', year: 2023, plate: 'PBA-1003', color: 'Gris',
        seats: 5, doors: 4, bag_capacity: 3, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'Sedan',
        price_per_day: 45.00, sup: rfPrime, dep: uioAero,
        desc: 'Sedán confiable, ideal para viajes largos.',
        img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Toyota_Corolla_Hybrid_Sedan%2C_GIMS_2019%2C_Le_Grand-Saconnex_%28GIMS1338%29.jpg/1280px-Toyota_Corolla_Hybrid_Sedan%2C_GIMS_2019%2C_Le_Grand-Saconnex_%28GIMS1338%29.jpg',
        img2: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Toyota_Corolla_sedan_E210_hydrid.jpg/1280px-Toyota_Corolla_sedan_E210_hydrid.jpg' },
      { vehicle_id: 'VEH-1004', make: 'Nissan', model: 'Sentra', year: 2022, plate: 'PBA-1004', color: 'Negro',
        seats: 5, doors: 4, bag_capacity: 3, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'Sedan',
        price_per_day: 42.00, sup: costa, dep: gye,
        desc: 'Sedán cómodo con excelente rendimiento.',
        img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Nissan_Sentra_%28B18%29_Washington_DC_Metro_Area%2C_USA.jpg/1280px-Nissan_Sentra_%28B18%29_Washington_DC_Metro_Area%2C_USA.jpg',
        img2: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/2024_Nissan_Sentra_%28B18%29_DSC_3754.jpg/1280px-2024_Nissan_Sentra_%28B18%29_DSC_3754.jpg' },
      { vehicle_id: 'VEH-1005', make: 'Hyundai', model: 'Tucson', year: 2023, plate: 'PBA-1005', color: 'Azul',
        seats: 5, doors: 5, bag_capacity: 4, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'SUV',
        price_per_day: 55.00, sup: rfPrime, dep: uioAero,
        desc: 'SUV moderna, ideal para viajes por la sierra.',
        img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Hyundai_Tucson_%28NX4%29_1X7A0424.jpg/1280px-Hyundai_Tucson_%28NX4%29_1X7A0424.jpg',
        img2: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/HYUNDAI_TUCSON_%28NX4%29_China.jpg/1280px-HYUNDAI_TUCSON_%28NX4%29_China.jpg' },
      { vehicle_id: 'VEH-1006', make: 'Toyota', model: 'RAV4', year: 2023, plate: 'PBA-1006', color: 'Blanco',
        seats: 5, doors: 5, bag_capacity: 4, transmission: 'automatica', fuel_type: 'hibrido', car_type: 'SUV',
        price_per_day: 65.00, sup: rfPrime, dep: uioCentro,
        desc: 'SUV híbrida, económica y potente.',
        img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/2021_Toyota_RAV4_PHV.jpg/1280px-2021_Toyota_RAV4_PHV.jpg',
        img2: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Toyota_RAV4_Hybrid_%28XA50%29_DSC_2709.jpg/1280px-Toyota_RAV4_Hybrid_%28XA50%29_DSC_2709.jpg' },
      { vehicle_id: 'VEH-1007', make: 'Ford', model: 'Ranger', year: 2022, plate: 'PBA-1007', color: 'Negro',
        seats: 5, doors: 4, bag_capacity: 5, transmission: 'manual', fuel_type: 'diesel', car_type: 'Camioneta',
        price_per_day: 60.00, sup: costa, dep: gye,
        desc: 'Pick-up 4x4 para carga y aventura.',
        img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Ford_Ranger_4x4_Wildtrak_2023_%2810%29.jpg/1280px-Ford_Ranger_4x4_Wildtrak_2023_%2810%29.jpg',
        img2: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Ford_Ranger_4x4_Wildtrak_2023_%2811%29.jpg/1280px-Ford_Ranger_4x4_Wildtrak_2023_%2811%29.jpg' },
      { vehicle_id: 'VEH-1008', make: 'Chevrolet', model: 'D-Max', year: 2023, plate: 'PBA-1008', color: 'Gris',
        seats: 5, doors: 4, bag_capacity: 5, transmission: 'manual', fuel_type: 'diesel', car_type: 'Camioneta',
        price_per_day: 58.00, sup: andina, dep: cue,
        desc: 'Camioneta robusta para trabajo pesado.',
        img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Chevrolet_D-Max_2008_3.5v6.jpg/1280px-Chevrolet_D-Max_2008_3.5v6.jpg',
        img2: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/2016_Isuzu_D-Max_2.5_LT_4x2%2C_06-30-2024.jpg/1280px-2016_Isuzu_D-Max_2.5_LT_4x2%2C_06-30-2024.jpg' },
      { vehicle_id: 'VEH-1009', make: 'BMW', model: 'Serie 3', year: 2023, plate: 'PBA-1009', color: 'Negro',
        seats: 5, doors: 4, bag_capacity: 3, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'Lujo',
        price_per_day: 120.00, sup: rfPrime, dep: uioAero,
        desc: 'Sedán premium con acabados de lujo.',
        img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/BMW_G20_3_Series_Jet_Black_%281%29.jpg/1280px-BMW_G20_3_Series_Jet_Black_%281%29.jpg',
        img2: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/BMW_330i_G20_M_Sport_2019.jpg/1280px-BMW_330i_G20_M_Sport_2019.jpg' },
      { vehicle_id: 'VEH-1010', make: 'Mercedes-Benz', model: 'Clase C', year: 2023, plate: 'PBA-1010', color: 'Plateado',
        seats: 5, doors: 4, bag_capacity: 3, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'Lujo',
        price_per_day: 135.00, sup: rfPrime, dep: uioCentro,
        desc: 'Elegancia y confort al máximo nivel.',
        img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Mercedes-Benz_C_200_AVANTGARDE_%28W206%29_front.jpg/1280px-Mercedes-Benz_C_200_AVANTGARDE_%28W206%29_front.jpg',
        img2: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Mercedes-Benz_C_200_AVANTGARDE_%28W206%29.jpg/1280px-Mercedes-Benz_C_200_AVANTGARDE_%28W206%29.jpg' },
    ];

    for (const d of catalogo) {
      const v = await vehicleRepo.save(vehicleRepo.create({
        vehicle_id: d.vehicle_id, make: d.make, model: d.model, year: d.year, plate: d.plate,
        color: d.color, seats: d.seats, doors: d.doors, bag_capacity: d.bag_capacity,
        transmission: d.transmission, fuel_type: d.fuel_type, car_type: d.car_type,
        air_conditioning: true, price_per_day: d.price_per_day,
        description: d.desc, main_image_url: d.img, status: 'AVAILABLE',
        supplier_id: d.sup.supplier_id, depot_id: d.dep.depot_id,
      }));
      await imgRepo.save([
        imgRepo.create({ url: d.img, position: 0, vehicle_id: v.vehicle_id }),
        imgRepo.create({ url: d.img2, position: 1, vehicle_id: v.vehicle_id }),
      ]);
    }
    console.log('  vehicles + imágenes creados');
  }

  await corregirOrtografia(ds);
  await sembrarUsuarios(ds);
  await sembrarReservasHistoricas(ds);

  console.log('OK - Datos iniciales listos');
  console.log('Cuentas demo:');
  console.log('  Admin:   admin@rentafacil.ec / Admin12345');
  console.log('  Cliente: maria@example.com   / Cliente12345');
  console.log('  Cliente: carlos@example.com  / Cliente12345');
  console.log('Uso: POST /api/v1/auth/token para obtener JWT con scopes.');
  await app.close();
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pasos idempotentes: se ejecutan en cada arranque (start:render) sin duplicar datos.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Textos sembrados antes sin tildes. Solo se reemplazan si siguen exactamente como se
 * sembraron, para no pisar cambios hechos desde el panel admin.
 */
async function corregirOrtografia(ds: DataSource) {
  const fixes: Array<[string, string, string, string]> = [
    ['vehicles', 'description', 'Vehiculo compacto, economico en combustible, ideal para ciudad.', 'Vehículo compacto, económico en combustible, ideal para la ciudad.'],
    ['vehicles', 'description', 'Sub-compacto moderno con transmision automatica.', 'Subcompacto moderno con transmisión automática.'],
    ['vehicles', 'description', 'Sedan confiable, ideal para viajes largos.', 'Sedán confiable, ideal para viajes largos.'],
    ['vehicles', 'description', 'Sedan comodo con excelente rendimiento.', 'Sedán cómodo con excelente rendimiento.'],
    ['vehicles', 'description', 'SUV hibrida, economica y potente.', 'SUV híbrida, económica y potente.'],
    ['vehicles', 'description', 'Sedan premium con acabados de lujo.', 'Sedán premium con acabados de lujo.'],
    ['vehicles', 'description', 'Elegancia y confort al maximo nivel.', 'Elegancia y confort al máximo nivel.'],
    ['depots', 'address', 'Aeropuerto Jose Joaquin de Olmedo', 'Aeropuerto José Joaquín de Olmedo'],
  ];
  let n = 0;
  for (const [tabla, col, antes, despues] of fixes) {
    const r = await ds.createQueryBuilder().update(tabla).set({ [col]: despues })
      .where(`"${col}" = :antes`, { antes }).execute();
    n += r.affected ?? 0;
  }
  if (n > 0) console.log(`  ortografía corregida en ${n} registros`);
}

/** Usuarios demo (antes estaban fijos en el código del AuthDemoController). */
async function sembrarUsuarios(ds: DataSource) {
  const repo = ds.getRepository(User);
  const demo = [
    { email: 'admin@rentafacil.ec', first_name: 'Anthony', last_name: 'Rosero', role: 'admin' as const, password: 'Admin12345' },
    { email: 'maria@example.com', first_name: 'María', last_name: 'Pérez', role: 'client' as const, password: 'Cliente12345', phone: '+593 99 111 2233' },
    { email: 'carlos@example.com', first_name: 'Carlos', last_name: 'Muñoz', role: 'client' as const, password: 'Cliente12345', phone: '+593 98 444 5566' },
  ];
  let creados = 0;
  for (const u of demo) {
    if (await repo.findOne({ where: { email: u.email } })) continue;
    const { password, ...datos } = u;
    await repo.save(repo.create({ ...datos, password_hash: hashPassword(password) }));
    creados++;
  }
  if (creados) console.log(`  ${creados} usuarios demo creados`);
}

/**
 * 12 reservas históricas CONFIRMED de maría y carlos, ya terminadas (entre hace 60 y hace 5 días),
 * para que el panel muestre ingresos reales. Se marcan con idempotency_key "seed-hist-NN":
 * solo se crean las que falten, así nunca se duplican aunque el seed corra en cada arranque.
 * (El contrato no tiene estado FINALIZADA: el panel las muestra como "Finalizada" por su fecha.)
 */
async function sembrarReservasHistoricas(ds: DataSource) {
  const orders = ds.getRepository(Order);
  const vehicles = ds.getRepository(Vehicle);
  const MS_DIA = 86_400_000;
  const hoy = new Date(); hoy.setUTCHours(10, 0, 0, 0);
  const hace = (dias: number) => new Date(hoy.getTime() - dias * MS_DIA);

  // [vehículo, cliente, inicio (hace N días), días de alquiler, extras]
  const historial: Array<[string, string, number, number, string[]]> = [
    ['VEH-1003', 'maria@example.com', 58, 4, ['GPS']],
    ['VEH-1005', 'carlos@example.com', 55, 7, []],
    ['VEH-1001', 'maria@example.com', 50, 3, []],
    ['VEH-1009', 'carlos@example.com', 46, 2, []],
    ['VEH-1007', 'carlos@example.com', 42, 10, ['GPS']],
    ['VEH-1002', 'maria@example.com', 38, 5, ['SILLA_BEBE']],
    ['VEH-1006', 'maria@example.com', 33, 6, []],
    ['VEH-1010', 'carlos@example.com', 29, 3, ['CONDUCTOR_ADICIONAL']],
    ['VEH-1004', 'maria@example.com', 24, 4, []],
    ['VEH-1008', 'carlos@example.com', 20, 8, []],
    ['VEH-1005', 'maria@example.com', 16, 5, ['GPS', 'SILLA_BEBE']],
    ['VEH-1003', 'carlos@example.com', 12, 7, []],
  ];

  let creadas = 0;
  for (const [i, [vehicleId, owner, inicioHace, dias, extras]] of historial.entries()) {
    const key = `seed-hist-${String(i + 1).padStart(2, '0')}`;
    if (await orders.findOne({ where: { idempotency_key: key } })) continue;
    const v = await vehicles.findOne({ where: { vehicle_id: vehicleId } });
    if (!v) continue; // vehículo eliminado desde el admin: se omite esa reserva

    const pickup = hace(inicioHace);
    const dropoff = new Date(pickup.getTime() + dias * MS_DIA);
    // Misma tarifa que /orders/preview: base + 5 USD por extra y día + 15 % de impuestos sobre la base
    const base = Number((Number(v.price_per_day) * dias).toFixed(2));
    const total = Number((base + extras.length * 5 * dias + base * 0.15).toFixed(2));
    const lugar = { city_id: v.depot_id <= 2 ? 1 : v.depot_id === 3 ? 2 : 3 };

    await orders.save(orders.create({
      locator: `RENTAFACIL-H${String(i + 1).padStart(5, '0')}`,
      status: 'CONFIRMED',
      vehicle_id: v.vehicle_id,
      owner_sub: owner,
      payment_reference: `PAY-SIM-HIST${String(i + 1).padStart(6, '0')}`,
      vehicle_details: {
        vehicle_id: v.vehicle_id, make: v.make, model: v.model, year: v.year,
        supplier_id: v.supplier_id, depot_id: v.depot_id, main_image_url: v.main_image_url,
      },
      route_details: {
        pickup: { datetime: pickup.toISOString(), location: lugar },
        dropoff: { datetime: dropoff.toISOString(), location: lugar },
      },
      driver_details: { email: owner },
      extras,
      total_price: total,
      currency: 'USD',
      idempotency_key: key,
      creation_date: new Date(pickup.getTime() - 3 * MS_DIA),
    }));
    creadas++;
  }
  if (creadas) console.log(`  ${creadas} reservas históricas creadas`);
}

bootstrap().catch((e) => { console.error('Error en seed:', e); process.exit(1); });

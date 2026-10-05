import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { Depot } from '../entities/depot.entity';
import { Supplier } from '../entities/supplier.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { VehicleImage } from '../entities/vehicle-image.entity';

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
        address: 'Aeropuerto Jose Joaquin de Olmedo',
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

    const catalogo = [
      { vehicle_id: 'VEH-1001', make: 'Chevrolet', model: 'Sail', year: 2023, plate: 'PBA-1001', color: 'Blanco',
        seats: 5, doors: 4, bag_capacity: 2, transmission: 'manual', fuel_type: 'gasolina', car_type: 'Compacto',
        price_per_day: 25.00, sup: rfPrime, dep: uioCentro,
        desc: 'Vehiculo compacto, economico en combustible, ideal para ciudad.',
        img: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=800' },
      { vehicle_id: 'VEH-1002', make: 'Kia', model: 'Rio', year: 2023, plate: 'PBA-1002', color: 'Rojo',
        seats: 5, doors: 4, bag_capacity: 2, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'Compacto',
        price_per_day: 30.00, sup: rfPrime, dep: uioAero,
        desc: 'Sub-compacto moderno con transmision automatica.',
        img: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800' },
      { vehicle_id: 'VEH-1003', make: 'Toyota', model: 'Corolla', year: 2023, plate: 'PBA-1003', color: 'Gris',
        seats: 5, doors: 4, bag_capacity: 3, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'Sedan',
        price_per_day: 45.00, sup: rfPrime, dep: uioAero,
        desc: 'Sedan confiable, ideal para viajes largos.',
        img: 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?w=800' },
      { vehicle_id: 'VEH-1004', make: 'Nissan', model: 'Sentra', year: 2022, plate: 'PBA-1004', color: 'Negro',
        seats: 5, doors: 4, bag_capacity: 3, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'Sedan',
        price_per_day: 42.00, sup: costa, dep: gye,
        desc: 'Sedan comodo con excelente rendimiento.',
        img: 'https://images.unsplash.com/photo-1550355291-bbee04a92027?w=800' },
      { vehicle_id: 'VEH-1005', make: 'Hyundai', model: 'Tucson', year: 2023, plate: 'PBA-1005', color: 'Azul',
        seats: 5, doors: 5, bag_capacity: 4, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'SUV',
        price_per_day: 55.00, sup: rfPrime, dep: uioAero,
        desc: 'SUV moderna, ideal para viajes por la sierra.',
        img: 'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800' },
      { vehicle_id: 'VEH-1006', make: 'Toyota', model: 'RAV4', year: 2023, plate: 'PBA-1006', color: 'Blanco',
        seats: 5, doors: 5, bag_capacity: 4, transmission: 'automatica', fuel_type: 'hibrido', car_type: 'SUV',
        price_per_day: 65.00, sup: rfPrime, dep: uioCentro,
        desc: 'SUV hibrida, economica y potente.',
        img: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800' },
      { vehicle_id: 'VEH-1007', make: 'Ford', model: 'Ranger', year: 2022, plate: 'PBA-1007', color: 'Negro',
        seats: 5, doors: 4, bag_capacity: 5, transmission: 'manual', fuel_type: 'diesel', car_type: 'Camioneta',
        price_per_day: 60.00, sup: costa, dep: gye,
        desc: 'Pick-up 4x4 para carga y aventura.',
        img: 'https://images.unsplash.com/photo-1595758228888-35eecd28d0f0?w=800' },
      { vehicle_id: 'VEH-1008', make: 'Chevrolet', model: 'D-Max', year: 2023, plate: 'PBA-1008', color: 'Gris',
        seats: 5, doors: 4, bag_capacity: 5, transmission: 'manual', fuel_type: 'diesel', car_type: 'Camioneta',
        price_per_day: 58.00, sup: andina, dep: cue,
        desc: 'Camioneta robusta para trabajo pesado.',
        img: 'https://images.unsplash.com/photo-1571245803099-0dcbf9ec2d7f?w=800' },
      { vehicle_id: 'VEH-1009', make: 'BMW', model: 'Serie 3', year: 2023, plate: 'PBA-1009', color: 'Negro',
        seats: 5, doors: 4, bag_capacity: 3, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'Lujo',
        price_per_day: 120.00, sup: rfPrime, dep: uioAero,
        desc: 'Sedan premium con acabados de lujo.',
        img: 'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800' },
      { vehicle_id: 'VEH-1010', make: 'Mercedes-Benz', model: 'Clase C', year: 2023, plate: 'PBA-1010', color: 'Plateado',
        seats: 5, doors: 4, bag_capacity: 3, transmission: 'automatica', fuel_type: 'gasolina', car_type: 'Lujo',
        price_per_day: 135.00, sup: rfPrime, dep: uioCentro,
        desc: 'Elegancia y confort al maximo nivel.',
        img: 'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=800' },
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
        imgRepo.create({ url: d.img.replace('?w=800', '?w=800&fit=crop&crop=edges'), position: 1, vehicle_id: v.vehicle_id }),
      ]);
    }
    console.log('  vehicles + imagenes creados');
  }

  console.log('OK - Datos iniciales listos');
  console.log('Cuentas demo:');
  console.log('  Admin:   admin@rentafacil.ec / Admin12345');
  console.log('  Cliente: maria@example.com   / Cliente12345');
  console.log('Uso: POST /api/v1/auth/token para obtener JWT con scopes.');
  await app.close();
  process.exit(0);
}

bootstrap().catch((e) => { console.error('Error en seed:', e); process.exit(1); });

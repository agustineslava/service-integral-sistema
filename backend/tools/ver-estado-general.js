require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const central = require('../src/db/central');

(async () => {
    console.log('\n[1] Los 4 usuarios de la central');
    const us = await central.query(
        `SELECT id, email, nombre, rol, empresa_id, activo, debe_cambiar_password, creado_en
           FROM usuarios_globales ORDER BY id`
    );
    console.table(us.map(u => ({
        id: u.id, email: u.email, rol: u.rol, empresa: u.empresa_id,
        activo: u.activo, debeCambiar: u.debe_cambiar_password
    })));

    console.log('\n[2] Las empresas');
    const em = await central.query(
        `SELECT id, nombre, slug, nombre_db, estado, plan, logo_url, telefono, color_primario
           FROM empresas ORDER BY id`
    );
    console.table(em.map(e => ({
        id: e.id, nombre: e.nombre, slug: e.slug, db: e.nombre_db,
        estado: e.estado, plan: e.plan, logo: e.logo_url, tel: e.telefono, color: e.color_primario
    })));

    console.log('\n[3] Cuentos que quedaron dando vueltas');
    const huerfanas = em.filter(e => /prueba|f5b|intrusa|f3/i.test(e.nombre || ''));
    console.log(huerfanas.length === 0
        ? '  ninguna'
        : '  ' + huerfanas.map(e => `#${e.id} ${e.nombre} (${e.estado})`).join(', '));

    const pruebas = us.filter(u => /prueba|f5b|intruso/i.test(u.email || ''));
    console.log(pruebas.length === 0
        ? '  ningun usuario de prueba'
        : '  ' + pruebas.map(u => `#${u.id} ${u.email}`).join(', '));

    console.log('\n[4] Cantidades que deberian seguir como estaban');
    const conteo = await central.uno(`
        SELECT (SELECT COUNT(*) FROM usuarios_globales) AS n_usuarios,
               (SELECT COUNT(*) FROM empresas)       AS n_empresas,
               (SELECT COUNT(*) FROM modulos)        AS n_modulos,
               (SELECT COUNT(*) FROM planes)         AS n_planes
    `);
    console.log(' ', conteo);

    await central.cerrar();
})().catch(async (e) => { console.error(e.message); try { await central.cerrar(); } catch {} process.exit(1); });
/* ==========================================================================
   PASA TILDES, PERO DIME CUALES
   --------------------------------------------------------------------------
   Los comentarios de este proyecto van en castellano con tilde. Los archivos
   nuevos se escribieron sin ella porque la terminal se los comio, y el
   resultado es un archivo que se lee raro al lado de los demas:
   `configuracion`, `mas`, `dia`, `codigo`.

   Poner tildes a mano es largo y es facil errar el tiempo verbal (`existo` vs
   `existio`). Pegarle un `.replace` automatico a todo el archivo es peor:
   rompe las palabras que NO llevan tilde y deja el texto mal escrito, que es
   un error mas visible que la falta de tilde.

   Asi que esto hace las dos cosas por separado:

       node tildes-revisar.js <archivo>
           lista cada palabra sospechosa con la linea y el contexto, y NO
           escribe nada. Es el paso de revisar.

       node tildes-revisar.js <archivo> --aplicar
           aplica el diccionario y muestra el cambio. Es el paso de aplicar, y
           se lee antes de commitear.

   El diccionario esta escrito a mano y es deliberadamente corto: solo las
   palabras que aparecen en este proyecto. Si una falta, se agrega y se corre
   otra vez. Es mas lento, pero cada cambio es una decision y no un accidente.

   LO QUE NO TOCA
   --------------------------------------------------------------------------
   - Identificadores: `codigo`, `numero`, `titulo` en `col('codigo', ...)` son
     nombres de campo que van al SQL y al JSON. Con tilde no existirian.
   - Cadenas de SQL y ENUM: 'EMITIDA', 'Cancelado', `estado IN (...)`.
   - Nombres de archivo y de tabla.
   - Lo que esta entre acentos graves, aunque la linea sea de comentario.

   El ultimo punto es el que hace que esto no rompa cosas. Un comentario puede
   estar citando codigo:

       `factura_items.descripcion` es una foto del nombre

   Si el diccionario cambiara `descripcion` por `descripción`, el comentario
   passaria a estar MENTIROSO: se seguiria leyendose bien y la columna que
   nombra ya no existiria. Peor que no poner tilde, porque nadie se aviva a
   corregir un comentario que parece correcto.
   ========================================================================== */

const fs = require('fs');

/* De la forma SIN tilde a la CON tilde. Solo castellano, y solo palabras que de
   verdad la llevan.

   LO QUE NO ESTA ACA, Y POR QUE NO

     solo    la RAE le quito la tilde: se escribe "solo", sin acento
     esta    es "esta" (demostrativo) o "esta" (verbo): depende de la frase
     aun     "aun asi" lleva tilde y "aun" (todavia, sin mas) no
     cuando  "cuando?" con interrogacion lleva tilde; "cuando se filtra", no
     como    interrogativo lleva tilde, comparativo no
     que     condicional, comparativo o interrogativo: depende de la frase
     cual    "tal cual" y "cual sea" NO llevan tilde; "cual de los dos", si
     cuanto  "en cuanto a" NO lleva tilde; "cuanto se facturo", si
     ser     "ser" y "se": depende
     este    demostrativo o pronombre con tilde
     si      afirmativo lleva tilde, condicional no

   Esas estan fuera a proposito. Un diccionario que las cambiara siempre
   acertaria una vez de cada dos, y un texto con la mitad de las tildes mal
   puestas se lee peor que uno sin tildes. Si aparece una, se agrega a mano.

   `cual` y `cuanto` se sacaron del mapa despues de que `tildes-revisar.js`
   propusiera "tal cual" -> "tal cuál". La propuesta sonaba bien y estaba mal:
   "tal cual" es un adverbio y se escribe sin tilde. Un diccionario que
   devuelve una regla falsa la mitad de las veces no se corrige con más entradas,
   se corrige con menos entradas. */
const CON_TILDE = {
    aca: 'acá',
    ademas: 'además',
    alla: 'allá',
    asi: 'así',
    catalogo: 'catálogo',
    codigo: 'código',
    codigos: 'códigos',
    configuracion: 'configuración',
    creacion: 'creación',
    deberia: 'debería',
    descripcion: 'descripción',
    despues: 'después',
    dia: 'día',
    dias: 'días',
    diria: 'diría',
    emision: 'emisión',
    estan: 'están',
    existo: 'existió',
    formula: 'fórmula',
    haria: 'haría',
    informacion: 'información',
    linea: 'línea',
    lineas: 'líneas',
    logica: 'lógica',
    mas: 'más',
    menu: 'menú',
    multiplicacion: 'multiplicación',
    ningun: 'ningún',
    numero: 'número',
    numeros: 'números',
    periodo: 'período',
    perdio: 'perdió',
    peticion: 'petición',
    podria: 'podría',
    precision: 'precisión',
    proposito: 'propósito',
    proximo: 'próximo',
    razon: 'razón',
    renglon: 'renglón',
    saldria: 'saldría',
    sesion: 'sesión',
    seria: 'sería',
    tendria: 'tendría',
    tecnico: 'técnico',
    teorica: 'teórica',
    titulo: 'título',
    unica: 'única',
    unico: 'único',
    ultama: 'última',
    ultimo: 'último',
    validos: 'válidos',
    veria: 'vería',
    version: 'versión'
};

/* Estas dos entran aparte porque la tilde va sobre la `a`, que es donde el ojo no
   la busca, y escribirlas en el mapa de arriba hace pensar que el error seria
   dificil de ver. */
CON_TILDE.parametros = 'parámetros';
CON_TILDE.parametro = 'párametro';
CON_TILDE.parametro = 'parámetro';

/* Las MAYUSCULAS de los titulos de seccion (`LO QUE NO SE HACE ACA`, `EL
   CATALOGO`, `PARAMETRO`) no las agarra el limite de palabra, que distingue
   mayusculas de minusculas. Se agrega la version en mayuscula de cada palabra,
   y solo de las que llevan tilde siempre: en mayuscula no hay "esta" de
   demostrativo ni "si" condicional, asi que no hay ambiguedad que temer.

   `QUE` y `COMO` quedan fuera a proposito: en mayuscula pueden ser
   condicionales ("NO SE HACE SI QUE") y la palabra sola no lo dice. */
/* `valida` y `validas` NO estan a proposito, y no es una omision: `valida`
   tambien es la tercera persona del verbo "validar", que es la forma que mas
   aparece en este proyecto ("la ruta valida el permiso"). El diccionario la
   convertia en "válida" y dejaba la frase en un adjetivo que no era. Un texto
   con la palabra cambiada de categoria gramatical esta PEOR que un texto sin
   tilde, porque el lector se fia de lo que lee.

   `valido` queda (el verbo "valido" en primera persona es rarísimo), `validos`
   queda (plural de adjetivo, no hay verbo). */

const EN_MAYUSCULAS = {};
const CON_INICIAL = {};
for (const [mal, bien] of Object.entries(CON_TILDE)) {
    EN_MAYUSCULAS[mal.toUpperCase()] = bien.toUpperCase();
    CON_INICIAL[mal.charAt(0).toUpperCase() + mal.slice(1)] =
        bien.charAt(0).toUpperCase() + bien.slice(1);
}

/* Si la linea es de comentario.

   No alcanza con mirar que empiece con asterisco: un bloque de comentario sigue
   siendo comentario en las lineas del medio, que no lo llevan. En este proyecto
   casi todos los bloques lo llevan, pero no todos, y una linea de esas se
   escapaba del diccionario sin avisar. Por eso se lleva el estado de "estoy
   adentro de un bloque" de una linea a la otra. */
function leerComentario(linea, dentroDeBloque) {
    const t = linea.trim();
    if (dentroDeBloque) {
        return { comentario: true, dentro: !t.endsWith('*/') };
    }
    if (t.startsWith('//')) return { comentario: true, dentro: false };
    if (t.startsWith('/*')) return { comentario: true, dentro: !t.endsWith('*/') };
    return { comentario: false, dentro: false };
}

/* Aplica el diccionario a UNA linea de comentario.

   La linea se parte por los acentos graves y solo se transforman los tramos
   pares (0, 2, 4...), que son los de castellano. Los impares son codigo. */
function tildar(linea) {
    const tramos = linea.split('`');
    for (let i = 0; i < tramos.length; i += 2) {
        let nuevo = tramos[i];
        for (const [mal, bien] of Object.entries(CON_TILDE)) {
            const re = new RegExp('\\b' + mal + '\\b', 'g');
            if (re.test(nuevo)) nuevo = nuevo.replace(re, bien);
        }
        for (const mapa of [EN_MAYUSCULAS, CON_INICIAL]) {
            for (const [mal, bien] of Object.entries(mapa)) {
                const re = new RegExp('\\b' + mal + '\\b', 'g');
                if (re.test(nuevo)) nuevo = nuevo.replace(re, bien);
            }
        }
        tramos[i] = nuevo;
    }
    return tramos.join('`');
}

const archivo = process.argv[2];
if (!archivo) {
    console.error('  uso: node tildes-revisar.js <archivo> [--aplicar]');
    process.exit(1);
}
const aplicar = process.argv.includes('--aplicar');

const original = fs.readFileSync(archivo, 'utf8');
const lineas = original.split(/\r?\n/);

const cambios = [];
let dentro = false;

for (let i = 0; i < lineas.length; i++) {
    const estado = leerComentario(lineas[i], dentro);
    dentro = estado.dentro;
    if (!estado.comentario) continue;

    const nueva = tildar(lineas[i]);
    if (nueva !== lineas[i]) cambios.push({ linea: i + 1, antes: lineas[i], despues: nueva });
}

if (!aplicar) {
    console.log('  ' + cambios.length + ' linea(s) de comentario con palabras sin tilde:');
    for (const c of cambios) {
        console.log('  ' + c.linea + ': ' + c.antes.trim());
        console.log('      ->  ' + c.despues.trim());
    }
    console.log('');
    console.log('  No se escribio nada. Con --aplicar se aplica el diccionario.');
    process.exit(0);
}

const eol = original.includes('\r\n') ? '\r\n' : '\n';
for (const c of cambios) lineas[c.linea - 1] = c.despues;
fs.writeFileSync(archivo, lineas.join(eol), 'utf8');

console.log('  ' + cambios.length + ' linea(s) cambiadas:');
for (const c of cambios) {
    console.log('  ' + c.linea + ': ' + c.antes.trim());
    console.log('      ->  ' + c.despues.trim());
}
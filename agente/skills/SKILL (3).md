---
name: empresa-config
description: Úsala siempre que haya que personalizar algo por empresa en Aexia (campos visibles u obligatorios, etiquetas de campos, categorías, mensajes de WhatsApp, textos) o que se toque la configuración de módulos del panel de superadmin.
---

# Personalización por empresa (configuración, no código)

Estado: diseño acordado, todavía no implementado. Confirma en `MEMORY.md` qué parte existe antes de asumir nada.

## Principio
Personalizar = datos de configuración en la base central. Nunca ramas de código por empresa. Si una empresa necesita una lógica realmente distinta, regístrala como variante del módulo (por ejemplo `facturacion` con `{"tipo":"interna"}`).

## Dónde se guarda
- `modulos.config_default` (JSON): lo que trae cada función. Puede variar por rubro de la empresa.
- `empresa_modulos.config` (JSON): solo lo que esa empresa cambia. Se mezcla sobre los defaults.
- Service Integral conserva exactamente lo actual como default.

## Forma de la configuración
```json
{
  "reparaciones": {
    "campos": {
      "tipo_cobertura": { "visible": false },
      "equipo": { "visible": true, "obligatorio": true, "etiqueta": "Equipo y Modelo" }
    },
    "whatsapp_tecnico": "🛠️ *ORDEN #{{id}}* - {{empresa}}\n👤 {{cliente}}\n⚠️ {{falla}}"
  },
  "stock": { "categorias": ["Lavarropas", "Heladeras", "Otros"] },
  "pedidos": { "whatsapp": "Pedido de repuestos - {{empresa}}\n{{items}}" }
}
```

## Cómo se conecta
1. Endpoint `/api/config-empresa`: devuelve la config ya mezclada de la empresa del token (mismo patrón que `/api/config-comercio`).
2. Frontend: cada campo lleva `data-campo="<nombre>"`; un script chico lo oculta o le cambia la etiqueta. Las plantillas reemplazan `{{variables}}` de una lista permitida, como texto plano.
3. Servidor: lee la misma config para validar. Si un campo está oculto, guarda su valor vacío o por defecto. El frontend nunca es la única defensa.
4. Panel de superadmin: editor por módulo con interruptores, cajas de texto, vista previa y "restaurar defaults".

## Reglas
- Hay campos que no se pueden ocultar (nombre del cliente, falla declarada). El código define la lista y el panel los muestra bloqueados.
- Las columnas NOT NULL (`equipo`, `falla_declarada`) exigen un valor: si el campo se oculta, el servidor guarda `''` o un valor por defecto. Nunca omitirlas.
- El servidor valida lo que guarda el panel: solo claves permitidas, largos máximos y solo variables de la lista. Una plantilla mal escrita no puede romper la pantalla.
- Variables de plantilla: se escapan al mostrarlas en HTML y se codifican (`encodeURIComponent`) en enlaces de WhatsApp.
- Categorías: son texto libre en la base. Al quitar una, los productos viejos conservan la suya.
- Fuera de la primera versión: estados de la orden (hoy son `enum` en la base y en el validador; personalizarlos exige migración).
- Revisa también presupuestos, facturas y reportes: si imprimen "Equipo" o "Garantía", deben leer la misma config.

## Al terminar
Indica qué claves de configuración agregaste, su valor por defecto y cómo probaste con dos empresas con configuraciones distintas.

# 📸 Instrucciones para Imagen Hero - Francis Carter Sanhueza

## 🎯 Especificaciones de la Imagen

### **Ubicación:**
```
/public/assets/francis-hero.jpg
```

### **Especificaciones Técnicas:**

| Aspecto | Especificación |
|---------|----------------|
| **Formato** | JPG o WebP |
| **Dimensiones** | 1920x1080px (Full HD) |
| **Peso máximo** | 200KB (optimizado) |
| **Orientación** | Horizontal (landscape) |
| **Aspect Ratio** | 16:9 |

---

## 📋 Requisitos de la Foto

### **Composición:**
- ✅ **Retrato profesional** de Francis Carter Sanhueza
- ✅ **Fondo neutro** o desenfocado (se aplicará overlay oscuro)
- ✅ **Persona centrada** o ligeramente a la derecha
- ✅ **Buena iluminación** natural o profesional
- ✅ **Mirada directa** a cámara (genera confianza)

### **Estilo Visual:**
- ✅ Profesional pero cercano
- ✅ Ropa formal o semi-formal
- ✅ Expresión seria pero amable
- ✅ Alta resolución y nitidez

### **Lo que se aplicará automáticamente:**
- Overlay oscuro (opacidad 70%)
- Filtro de escala de grises (30%)
- Gradiente de color azul-verde (30% opacidad)

---

## 🎨 Ejemplo Visual de Referencia

### **Inspiración:** https://diegovz.com/
La imagen de fondo debe ser similar a:
- Retrato de medio cuerpo o busto
- Fondo que no distraiga del texto
- Alta calidad profesional

---

## 🔧 Cómo Optimizar la Imagen

### **Opción 1: Online (TinyPNG)**
1. Ir a https://tinypng.com/
2. Subir imagen de Francis
3. Descargar versión optimizada
4. Guardar como `francis-hero.jpg`

### **Opción 2: Photoshop**
1. Abrir imagen
2. Image → Image Size → 1920x1080px
3. File → Export → Save for Web
4. Formato: JPEG
5. Calidad: 70-80%
6. Guardar como `francis-hero.jpg`

---

## 📁 Ubicación Final

```
tuasesorsocial/
├── public/
│   └── assets/
│       └── francis-hero.jpg  ← AQUÍ
└── views/
    └── index.html (ya actualizado)
```

---

## ✅ Checklist de Imagen

Antes de subir la imagen, verifica:

- [ ] Dimensiones: 1920x1080px
- [ ] Peso: < 200KB
- [ ] Formato: .jpg o .webp
- [ ] Nombre archivo: `francis-hero.jpg`
- [ ] Ubicación: `/public/assets/`
- [ ] Calidad profesional
- [ ] Buena iluminación
- [ ] Rostro visible y centrado

---

## 🎯 Alternativa Temporal

Si aún no tienes la foto de Francis, puedes usar temporalmente:

### **Placeholder con iniciales:**
Crear imagen con sus iniciales "FCS" en Canva:
1. Ir a canva.com
2. Custom Size: 1920x1080px
3. Fondo: Degradado azul oscuro
4. Texto: "FCS" gigante centrado
5. Exportar como JPG
6. Guardar como `francis-hero.jpg`

---

## 🚀 Probar el Resultado

Una vez agregada la imagen:

```bash
# Reiniciar servidor
npm start

# Abrir en navegador
http://localhost:3000
```

La imagen debe verse:
- ✅ Como fondo del hero
- ✅ Con overlay oscuro
- ✅ Con texto legible encima
- ✅ Responsive en móvil

---

## 📊 Ejemplo de Código (ya aplicado)

```css
.hero::before {
    content: '';
    position: absolute;
    background: url('/assets/francis-hero.jpg') center center no-repeat;
    background-size: cover;
    opacity: 0.3;
    filter: grayscale(30%);
}
```

---

## 💡 Tips Profesionales

### **Para mejor impacto visual:**
1. ✅ Foto profesional de estudio (ideal)
2. ✅ Luz natural frente a ventana (buena opción)
3. ✅ Fondo liso (pared blanca/gris)
4. ✅ Cámara a altura de ojos
5. ✅ Distancia focal 50-85mm (para retratos)

### **Qué evitar:**
- ❌ Selfies
- ❌ Fotos borrosas o pixeladas
- ❌ Fondos muy ocupados
- ❌ Iluminación deficiente
- ❌ Imágenes de redes sociales (baja resolución)

---

## 📞 Si Necesitas Ayuda

**Opciones para obtener la foto:**
1. **Fotógrafo profesional** - $50.000 - $100.000 (ideal)
2. **Sesión rápida en estudio** - $20.000 - $40.000
3. **Foto con smartphone** - Gratis (con buena luz)

**Requisitos mínimos:**
- Cámara de 12MP+
- Luz natural abundante
- Fondo neutro
- Alguien que te tome la foto (no selfie)

---

**Fecha creación:** 2026-07-16  
**Archivo:** INSTRUCCIONES-IMAGEN-HERO.md  
**Estado:** ⏳ Pendiente foto de Francis

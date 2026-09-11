# Tu Asesor Social - Aplicación Node.js

Sitio web profesional de asesoría social en Chile, optimizado para SEO y listo para deployment en Hetzner.

## 🚀 Características

- ✅ **Node.js + Express** - Servidor rápido y escalable
- ✅ **SEO Optimizado** - Meta tags, Open Graph, Schema.org, sitemap.xml
- ✅ **Diseño Moderno** - Animaciones de scroll, responsive, paleta profesional
- ✅ **Rutas SEO-friendly** - URLs limpias con trailing slash
- ✅ **Rendimiento** - Compresión gzip, headers de seguridad
- ✅ **Listo para producción** - Configuración para Hetzner incluida

## 📁 Estructura del proyecto

```
tuasesorsocial/
├── server.js              # Servidor Express principal
├── package.json           # Dependencias del proyecto
├── sitemap.xml            # Sitemap para Google
├── robots.txt             # Instrucciones para crawlers
├── DEPLOYMENT.md          # Guía completa de deployment
├── public/                # Archivos estáticos
│   ├── css/
│   ├── js/
│   └── assets/           # Imágenes, logos, etc.
└── views/                 # Páginas HTML
    ├── index.html         # Homepage
    ├── subsidio-electrico.html
    ├── mediacion-familiar.html
    └── subsidio-de-arriendo.html
```

## 🛠️ Instalación local

```bash
# Clonar o navegar al proyecto
cd C:\Users\crist\Desktop\tuasesorsocial

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm start

# O usar nodemon para auto-reload
npm run dev
```

El servidor estará disponible en: **http://localhost:3000**

## 📄 Páginas disponibles

| Página | URL | SEO Status |
|--------|-----|------------|
| Homepage | `/` | ✅ Optimizada |
| Subsidio Eléctrico | `/subsidio-electrico/` | ✅ Optimizada (8K impresiones/mes) |
| Mediación Familiar | `/mediacion-familiar/` | ✅ Optimizada |
| Subsidio de Arriendo | `/subsidio-de-arriendo/` | ✅ Optimizada |

## 🎨 Paleta de colores

- **Azul confiable:** `#2563eb`
- **Verde esperanza:** `#059669`
- **Naranja acogedor:** `#ea580c`
- **Gris oscuro:** `#1f2937`
- **Gris claro:** `#f3f4f6`

## 📊 Migración desde WordPress

### Ventajas de migrar:

1. ✅ **Más rápido:** Node.js es 3-5x más rápido que WordPress
2. ✅ **Más seguro:** Menos superficie de ataque, sin plugins vulnerables
3. ✅ **Más barato:** No necesitas base de datos MySQL
4. ✅ **Más control:** Código simple y mantenible
5. ✅ **Mejor SEO:** Páginas estáticas ultra-rápidas

### Plan de migración:

Ver el archivo **[DEPLOYMENT.md](DEPLOYMENT.md)** para instrucciones detalladas.

**Resumen:**
1. Hacer backup completo de WordPress actual
2. Subir aplicación Node.js a Hetzner
3. Configurar PM2 para gestión de procesos
4. Configurar Nginx como proxy reverso
5. Activar SSL con Let's Encrypt
6. Reemplazar WordPress por Node.js
7. Monitorear Google Search Console por 14 días

## 🔐 SEO y contenido preservado

### Contenido mantenido del WordPress original:

✅ Títulos SEO idénticos  
✅ Meta descriptions optimizadas  
✅ Estructura de URLs preservada  
✅ Contenido que rankea mantenido  
✅ Palabras clave principales incluidas  
✅ Schema.org para rich snippets  

### Mejoras SEO implementadas:

✅ Sitemap.xml automático  
✅ Robots.txt configurado  
✅ Open Graph para redes sociales  
✅ Velocidad de carga mejorada  
✅ Headers de seguridad  
✅ Compresión gzip  

## 📈 Datos de tráfico actual (Google Search Console)

- **Homepage:** 386 clics/mes, 7,281 impresiones
- **Subsidio Eléctrico:** 54 clics/mes, 8,085 impresiones ⚡ OPORTUNIDAD
- **Mediación Familiar:** 5 clics/mes
- **Subsidio Arriendo:** 0 clics, 680 impresiones

**Objetivo post-migración:** Mantener el 100% del tráfico actual + mejorar CTR en subsidio eléctrico.

## 🚀 Deployment en Hetzner

Ver **[DEPLOYMENT.md](DEPLOYMENT.md)** para guía completa paso a paso.

**Puerto asignado:** 3003 (evita conflictos con almamaedia.cl y divisachile.cl)

## 🔄 Comandos útiles

```bash
# Desarrollo local
npm start          # Iniciar servidor
npm run dev        # Iniciar con nodemon (auto-reload)

# En producción (Hetzner)
pm2 start ecosystem.config.js    # Iniciar con PM2
pm2 logs tuasesorsocial         # Ver logs
pm2 restart tuasesorsocial      # Reiniciar
pm2 stop tuasesorsocial         # Detener
```

## 📝 Próximos pasos recomendados

1. **Agregar imágenes reales:**
   - Logo profesional en `/public/assets/logo.png`
   - Fotos de servicios en `/public/assets/`
   
2. **Conectar formulario de contacto:**
   - Integrar con servicio de email (SendGrid, etc.)
   - O configurar envío desde el servidor

3. **Agregar Google Analytics:**
   - Insertar tracking code en todas las páginas

4. **Optimizar para conversión:**
   - A/B testing de CTAs
   - Heatmaps (Hotjar)
   - Mejorar textos según datos de usuarios

5. **Expandir contenido:**
   - Blog de artículos sobre beneficios sociales
   - Más guías de subsidios
   - FAQs expandidas

## 🆘 Soporte

Para dudas sobre deployment o modificaciones, revisar:
- [DEPLOYMENT.md](DEPLOYMENT.md) - Guía completa de deployment
- [server.js](server.js) - Configuración del servidor
- Logs de PM2: `pm2 logs tuasesorsocial`
- Logs de Nginx: `/var/log/nginx/tuasesorsocial_*.log`

---

**Desarrollado con ❤️ para Tu Asesor Social**  
*Asistencia y Consultoría Social Online - Chile*

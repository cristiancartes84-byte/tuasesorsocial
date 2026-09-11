# Guía de Deployment en Hetzner

## 📋 Pre-requisitos

- Servidor en Hetzner (ya tienes almamaedia.cl y divisachile.cl)
- Dominio: tuasesorsocial.cl configurado
- Node.js 18+ instalado en el servidor
- Nginx configurado como proxy reverso
- PM2 para gestión de procesos

---

## 🚀 Paso 1: Subir archivos al servidor

### Opción A: Via SCP/SFTP
```bash
scp -r C:\Users\crist\Desktop\tuasesorsocial root@tu-servidor-hetzner:/var/www/
```

### Opción B: Via Git (recomendado)
```bash
# En local
cd C:\Users\crist\Desktop\tuasesorsocial
git init
git add .
git commit -m "Initial commit - Tu Asesor Social"
git push origin main

# En servidor
cd /var/www
git clone https://tu-repositorio.git tuasesorsocial
```

---

## 🔧 Paso 2: Configurar el servidor

### 2.1 Instalar dependencias
```bash
cd /var/www/tuasesorsocial
npm install --production
```

### 2.2 Configurar PM2
```bash
# Crear archivo de configuración PM2
nano ecosystem.config.js
```

Contenido de `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'tuasesorsocial',
    script: './server.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3003
    }
  }]
};
```

### 2.3 Iniciar aplicación con PM2
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## 🌐 Paso 3: Configurar Nginx

### 3.1 Crear configuración de Nginx
```bash
nano /etc/nginx/sites-available/tuasesorsocial.cl
```

Contenido:
```nginx
server {
    listen 80;
    server_name tuasesorsocial.cl www.tuasesorsocial.cl;

    # Redirección a HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tuasesorsocial.cl www.tuasesorsocial.cl;

    # Certificados SSL (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/tuasesorsocial.cl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tuasesorsocial.cl/privkey.pem;

    # Configuración SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    gzip_min_length 256;

    # Headers de seguridad
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy a Node.js
    location / {
        proxy_pass http://localhost:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Cache de archivos estáticos
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf)$ {
        proxy_pass http://localhost:3003;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Sitemap y robots
    location = /sitemap.xml {
        proxy_pass http://localhost:3003;
        expires 1d;
    }

    location = /robots.txt {
        proxy_pass http://localhost:3003;
        expires 1d;
    }

    # Logs
    access_log /var/log/nginx/tuasesorsocial_access.log;
    error_log /var/log/nginx/tuasesorsocial_error.log;
}
```

### 3.2 Activar configuración
```bash
ln -s /etc/nginx/sites-available/tuasesorsocial.cl /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

---

## 🔐 Paso 4: Configurar SSL con Let's Encrypt

```bash
certbot --nginx -d tuasesorsocial.cl -d www.tuasesorsocial.cl
```

---

## 📊 Paso 5: Verificar que todo funciona

### 5.1 Verificar PM2
```bash
pm2 status
pm2 logs tuasesorsocial --lines 50
```

### 5.2 Verificar Nginx
```bash
systemctl status nginx
tail -f /var/log/nginx/tuasesorsocial_error.log
```

### 5.3 Probar en navegador
- http://tuasesorsocial.cl → Debe redirigir a HTTPS
- https://tuasesorsocial.cl → Debe mostrar la web
- https://tuasesorsocial.cl/subsidio-electrico/ → Debe funcionar
- https://tuasesorsocial.cl/sitemap.xml → Debe mostrar el sitemap

---

## 🔄 Paso 6: Migración desde WordPress

### 6.1 ANTES de reemplazar la web actual:

1. **Hacer backup completo del WordPress actual**
```bash
# Backup de archivos
tar -czf wordpress-backup-$(date +%Y%m%d).tar.gz /ruta/wordpress/actual

# Backup de base de datos (si tienes)
mysqldump -u usuario -p nombre_bd > wordpress-db-backup-$(date +%Y%m%d).sql
```

2. **Configurar Google Search Console**
   - Agregar nueva propiedad para la versión Node.js
   - Subir sitemap.xml
   - Solicitar indexación de las páginas principales

3. **Configurar redirects 301** (si algunas URLs cambiaron)
   - En Nginx, agregar redirects permanentes desde URLs antiguas a nuevas

### 6.2 Día del cambio:

1. Desactivar WordPress
2. Activar la aplicación Node.js en el puerto 3003
3. Actualizar configuración de Nginx para apuntar al puerto 3003
4. Recargar Nginx

### 6.3 Después del cambio:

1. Monitorear Google Search Console durante 7-14 días
2. Revisar que no haya caídas drásticas de tráfico
3. Verificar que todas las URLs respondan correctamente

---

## 📈 Paso 7: Monitoreo y optimización SEO

### 7.1 Enviar sitemap a Google
```
https://search.google.com/search-console
→ Sitemaps → Agregar sitemap → https://tuasesorsocial.cl/sitemap.xml
```

### 7.2 Verificar indexación
```
site:tuasesorsocial.cl en Google
```

### 7.3 Verificar velocidad
- https://pagespeed.web.dev/
- https://gtmetrix.com/

---

## 🆘 Troubleshooting

### Error: Puerto 3003 ya en uso
```bash
lsof -i :3003
kill -9 <PID>
pm2 restart tuasesorsocial
```

### Error: Nginx no puede conectar
```bash
# Verificar que Node.js esté corriendo
pm2 status

# Verificar firewall
ufw status
ufw allow 3003
```

### Error 502 Bad Gateway
```bash
# Ver logs
pm2 logs tuasesorsocial
tail -f /var/log/nginx/tuasesorsocial_error.log
```

---

## ✅ Checklist final antes de producción

- [ ] Todas las páginas cargan correctamente
- [ ] SSL configurado y funcionando
- [ ] Redirects HTTP → HTTPS funcionan
- [ ] Sitemap.xml accesible
- [ ] Robots.txt accesible
- [ ] Google Search Console configurado
- [ ] PM2 configurado para auto-reinicio
- [ ] Backup de WordPress antiguo realizado
- [ ] Logs de Nginx funcionando
- [ ] Todas las URLs con trailing slash funcionan
- [ ] Meta tags SEO verificados en todas las páginas
- [ ] Formulario de contacto funcional (si aplica)
- [ ] WhatsApp links funcionando
- [ ] Velocidad de carga < 3 segundos

---

## 📞 Notas adicionales

- **Puerto asignado:** 3003 (para no conflictuar con almamaedia.cl y divisachile.cl)
- **Proceso PM2:** nombre "tuasesorsocial"
- **Logs Nginx:** `/var/log/nginx/tuasesorsocial_*.log`
- **Directorio:** `/var/www/tuasesorsocial`

## 🔄 Actualización posterior

Para actualizar contenido después del deployment:

```bash
# En servidor
cd /var/www/tuasesorsocial
git pull origin main
npm install --production
pm2 restart tuasesorsocial
```

---

**Migración recomendada:** Hacerlo un día de bajo tráfico (lunes-miércoles) y en horario de baja actividad (madrugada).

// Función para comprimir una imagen del lado del cliente apuntando a un límite de peso
function comprimirImagen(archivo, pesoMaximoKB = 200) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(archivo);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Si la imagen es gigante, la achicamos a un máximo de 1024px para agilizar
                const MAX_WIDTH = 1024;
                const MAX_HEIGHT = 1024;
                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Empezamos con una calidad alta (90%) e iremos bajando si excede el peso deseado
                let calidad = 0.9;
                
                function ajustarCalidad() {
                    canvas.toBlob((blob) => {
                        const pesoKB = blob.size / 1024;
                        // Si el peso es menor al deseado o la calidad ya es muy baja, resolvemos
                        if (pesoKB <= pesoMaximoKB || calidad <= 0.2) {
                            const archivoComprimido = new File([blob], archivo.name, {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });
                            resolve(archivoComprimido);
                        } else {
                            // Bajamos la calidad de compresión un 10% y reintentamos
                            calidad -= 0.1;
                            ajustarCalidad();
                        }
                    }, 'image/jpeg', calidad);
                }

                ajustarCalidad();
            };
        };
        reader.onerror = (err) => reject(err);
    });
}
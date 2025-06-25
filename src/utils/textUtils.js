// Función para normalizar nombres (remover espacios extra, normalizar mayúsculas/minúsculas)
export const normalizeName = (name) => {
    if (!name) return '';
    return name.toString()
        .trim()
        .toLowerCase()
        .normalize("NFD") // Normalizar caracteres acentuados
        .replace(/[\u0300-\u036f]/g, "") // Remover diacríticos
        .replace(/\s+/g, ' '); // Remover espacios múltiples
};

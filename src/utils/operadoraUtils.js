import { normalizeName } from './textUtils';

/**
 * Obtiene la teleoperadora asignada a un beneficiario basado en su teléfono o nombre
 * @param {string|number} telefono - Teléfono del beneficiario
 * @param {string} nombre - Nombre del beneficiario
 * @param {Object} assignments - Objeto con las asignaciones de teleoperadoras
 * @returns {string} Nombre de la teleoperadora o 'No identificada'
 */
export const getTeleoperadora = (telefono, nombre, assignments) => {
    if (!assignments?.asignaciones) {
        return 'No identificada';
    }

    const normalizedTelefono = telefono?.toString().trim();
    const normalizedNombre = normalizeName(nombre);

    if (!normalizedTelefono && !normalizedNombre) {
        return 'No identificada';
    }

    for (const [operadoraNombre, asignaciones] of Object.entries(assignments.asignaciones)) {
        if (!Array.isArray(asignaciones)) continue;

        const encontrado = asignaciones.some(asignacion => {
            if (!asignacion) return false;
            
            const nombreAsignacionNormalizado = normalizeName(asignacion.beneficiario);
            const nombreCoincide = normalizedNombre && nombreAsignacionNormalizado === normalizedNombre;
            
            const telefonoCoincide = normalizedTelefono && asignacion.telefonos && 
                Array.isArray(asignacion.telefonos) &&
                asignacion.telefonos.some(tel => tel?.toString().trim() === normalizedTelefono);

            return nombreCoincide || telefonoCoincide;
        });
        
        if (encontrado) return operadoraNombre;
    }
    
    return 'No identificada';
};

/**
 * Valida si un beneficiario tiene una teleoperadora asignada
 * @param {string} nombre - Nombre del beneficiario
 * @param {Object} assignments - Objeto con las asignaciones de teleoperadoras
 * @returns {boolean} True si tiene asignación, false si no
 */
export const tieneAsignacionTeleoperadora = (nombre, assignments) => {
    return getTeleoperadora(null, nombre, assignments) !== 'No identificada';
};

// Convertir fecha de Excel a ISO string
export const excelDateToISO = (fecha, hora = null) => {
    if (!fecha) return null;
    try {
        // Si es número (formato Excel)
        if (typeof fecha === 'number') {
            const excelDate = new Date((fecha - 25569) * 86400 * 1000);
            return excelDate.toISOString();
        }

        // Si ya es ISO string
        if (typeof fecha === 'string' && fecha.includes('T')) {
            return fecha;
        }

        // Si es string con formato dd/mm/yyyy o dd-mm-yyyy
        let fechaParts;
        if (fecha.includes('/')) {
            fechaParts = fecha.split('/');
        } else if (fecha.includes('-')) {
            fechaParts = fecha.split('-');
        } else {
            return null;
        }

        let [day, month, year] = fechaParts.map(n => parseInt(n, 10));
        
        // Ajustar año si es de dos dígitos
        if (year < 100) {
            year = year + 2000;
        }

        // Validar componentes de la fecha
        if (!day || !month || !year || month > 12 || day > 31) return null;

        // Construir fecha con hora si está disponible
        let dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        if (hora) {
            dateStr += `T${hora.toString().padStart(8, '0')}`;
        } else {
            dateStr += 'T00:00:00.000Z';
        }

        const date = new Date(dateStr);
        return !isNaN(date.getTime()) ? date.toISOString() : null;
    } catch (error) {
        console.error('Error parsing date:', fecha, error);
        return null;
    }
};

// Serializar una llamada para almacenamiento/contexto
export const serializeLlamada = (llamada) => {
    if (!llamada || typeof llamada !== 'object') return null;
    return {
        fecha: llamada.fecha ? excelDateToISO(llamada.fecha) : null,
        hora: llamada.hora || null,
        duracion: llamada.duracion || 0,
        tipo: llamada.tipo || '',
        telefono: llamada.telefono || '',
        teleoperadora: llamada.teleoperadora || '',
        comentarios: llamada.comentarios || ''
    };
};

// Serializar un array de llamadas
export const serializeLlamadas = (llamadas) => {
    if (!Array.isArray(llamadas)) return [];
    return llamadas.filter(Boolean).map(serializeLlamada).filter(Boolean);
};

// Convertir estructuras de datos para serialización
export const prepareStatsForStorage = (stats) => {
    if (!stats) return null;

    try {
        return {
            totalLlamadas: stats.totalLlamadas || 0,
            entrantes: stats.entrantes || 0,
            salientes: stats.salientes || 0,
            duracionTotal: stats.duracionTotal || 0,
            duracionPromedio: stats.duracionPromedio || 0,
            beneficiarios: Array.from(stats.beneficiarios || []),
            beneficiariosAlDia: Array.from(stats.beneficiariosAlDia || []),
            beneficiariosPendientes: Array.from(stats.beneficiariosPendientes || []),
            beneficiariosUrgentes: Array.from(stats.beneficiariosUrgentes || []),
            comunas: Object.fromEntries(stats.comunas || new Map()),
            teleoperadoras: stats.teleoperadoras || {},
            llamadasPorBeneficiario: Object.fromEntries(
                Object.entries(stats.llamadasPorBeneficiario || {}).map(([key, datos]) => [
                    key,
                    Array.isArray(datos) ? serializeLlamadas(datos) : datos
                ])
            ),
            ultimasLlamadas: Object.fromEntries(
                Object.entries(stats.ultimasLlamadas || {}).map(([key, llamada]) => [
                    key,
                    serializeLlamada(llamada)
                ]).filter(([_, llamada]) => llamada !== null)
            ),
            llamadasExitosas: Object.fromEntries(
                Object.entries(stats.llamadasExitosas || {}).map(([key, llamadas]) => [
                    key,
                    serializeLlamadas(llamadas)
                ])
            )
        };
    } catch (error) {
        console.error('Error preparing stats for storage:', error);
        return null;
    }
};

import React, { useState, useEffect, useContext, useMemo } from 'react';
import { DataContext } from '../App';
import { ExclamationTriangleIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

const STATUS = {
    OK: 'ok',
    WARNING: 'warning', // 15+ días
    DANGER: 'danger'    // 30+ días
};

const StatusBadge = ({ status, days }) => {
    const configs = {
        [STATUS.OK]: {
            className: 'bg-green-100 text-green-800 border-green-200',
            icon: CheckCircleIcon,
            text: 'Al día'
        },
        [STATUS.WARNING]: {
            className: 'bg-yellow-100 text-yellow-800 border-yellow-200',
            icon: ExclamationTriangleIcon,
            text: 'Atención'
        },
        [STATUS.DANGER]: {
            className: 'bg-red-100 text-red-800 border-red-200',
            icon: XCircleIcon,
            text: 'Urgente'
        }
    };

    const config = configs[status];
    const Icon = config.icon;

    return (
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-sm font-medium ${config.className}`}>
            <Icon className="h-4 w-4" />
            <span>{config.text}</span>
            <span className="ml-1">({days} días)</span>
        </div>
    );
};

const BeneficiaryCard = ({ beneficiary, contacts }) => {
    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        try {
            const [day, month, year] = dateStr.split('-').map(num => num.trim());
            return new Date(year, month - 1, day);
        } catch (error) {
            console.error('Error parsing date:', dateStr, error);
            return null;
        }
    };

    const getDaysSince = (dateStr) => {
        if (!dateStr) return 999;
        const date = parseDate(dateStr);
        if (!date) return 999;
        return Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
    };

    // Encontrar el último contacto exitoso
    const lastSuccessfulContact = contacts
        .filter(c => c.exitoso)
        .sort((a, b) => {
            const dateA = parseDate(a.fecha);
            const dateB = parseDate(b.fecha);
            return (dateB || 0) - (dateA || 0);
        })[0]?.fecha;

    const daysSinceContact = getDaysSince(lastSuccessfulContact);

    const status = daysSinceContact >= 30 ? STATUS.DANGER :
                   daysSinceContact >= 15 ? STATUS.WARNING :
                   STATUS.OK;

    const statusClasses = {
        [STATUS.OK]: 'border-green-200 hover:border-green-300',
        [STATUS.WARNING]: 'border-yellow-200 hover:border-yellow-300',
        [STATUS.DANGER]: 'border-red-200 hover:border-red-300'
    };

    // Obtener contactos de este mes
    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();
    
    const contactsThisMonth = contacts.filter(c => {
        const date = parseDate(c.fecha);
        return date && 
               date.getMonth() === thisMonth &&
               date.getFullYear() === thisYear;
    });

    const successfulContactsThisMonth = contactsThisMonth.filter(c => c.exitoso).length;

    return (
        <div className={`bg-white rounded-lg shadow-sm border-2 ${statusClasses[status]} transition-colors duration-150`}>
            <div className="flex justify-between items-start mb-3 p-4">
                <h3 className="font-semibold text-gray-900 text-lg">{beneficiary}</h3>
                <StatusBadge status={status} days={daysSinceContact} />
            </div>
            
            <div className="space-y-2 text-sm text-gray-600 p-4 bg-gray-50 rounded-b-lg">
                <div className="flex justify-between items-center border-b border-gray-200 pb-2">
                    <span>Contactos este mes:</span>
                    <div className="text-right">
                        <span className="font-medium">{contactsThisMonth.length}</span>
                        <span className="text-green-600 ml-2">
                            ({successfulContactsThisMonth} exitosos)
                        </span>
                    </div>
                </div>
                <div className="flex justify-between items-center">
                    <span>Último contacto exitoso:</span>
                    <span className={`font-medium ${!lastSuccessfulContact ? 'text-red-500' : ''}`}>
                        {lastSuccessfulContact ? 
                            parseDate(lastSuccessfulContact).toLocaleDateString() :
                            'Sin contactos exitosos'}
                    </span>
                </div>
            </div>
        </div>
    );
};

const FilterTabs = ({ activeFilter, onFilterChange, counts }) => (
    <div className="flex space-x-2 mb-6">
        <button
            onClick={() => onFilterChange('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150
                ${activeFilter === 'all' 
                    ? 'bg-gray-900 text-white' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
            Todos ({counts.all})
        </button>
        <button
            onClick={() => onFilterChange('urgent')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150
                ${activeFilter === 'urgent' 
                    ? 'bg-red-600 text-white' 
                    : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
        >
            Urgentes ({counts.urgent})
        </button>
        <button
            onClick={() => onFilterChange('warning')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150
                ${activeFilter === 'warning' 
                    ? 'bg-yellow-500 text-white' 
                    : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'}`}
        >
            Pendientes ({counts.warning})
        </button>
        <button
            onClick={() => onFilterChange('ok')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150
                ${activeFilter === 'ok' 
                    ? 'bg-green-600 text-white' 
                    : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
        >
            Al día ({counts.ok})
        </button>
    </div>
);

const SearchBar = ({ value, onChange }) => (
    <div className="relative mb-6">
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="Buscar beneficiario..."
            className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-150"
        />
    </div>
);

function FollowUpHistory() {
    const { callData } = useContext(DataContext);
    const [followUpData, setFollowUpData] = useState([]);
    const [activeFilter, setActiveFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    // Función para parsear fechas en formato DD-MM-YYYY
    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        try {
            const [day, month, year] = dateStr.split('-').map(num => num.trim());
            return new Date(year, month - 1, day);
        } catch (error) {
            console.error('Error parsing date:', dateStr, error);
            return null;
        }
    };

    // Función para calcular días desde una fecha
    const getDaysSince = (dateStr) => {
        if (!dateStr) return 999;
        const date = parseDate(dateStr);
        if (!date) return 999;
        return Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
    };

    useEffect(() => {
        if (!callData?.detallesLlamadas) return;

        // Agrupar llamadas por beneficiario
        const beneficiaryContacts = callData.detallesLlamadas.reduce((acc, call) => {
            if (!acc[call.beneficiario]) {
                acc[call.beneficiario] = [];
            }
            
            const exitoso = call.resultado?.toLowerCase().includes('exitoso') || false;
            acc[call.beneficiario].push({
                fecha: call.fecha,
                tipo: call.evento,
                duracion: call.segundos,
                resultado: call.resultado,
                exitoso: exitoso
            });
            return acc;
        }, {});

        // Convertir a array y ordenar por último contacto exitoso
        const followUpArray = Object.entries(beneficiaryContacts)
            .map(([beneficiary, contacts]) => {
                // Encontrar el último contacto exitoso
                const lastSuccessfulContact = contacts
                    .filter(c => c.exitoso)
                    .sort((a, b) => {
                        const dateA = parseDate(a.fecha);
                        const dateB = parseDate(b.fecha);
                        return (dateB || 0) - (dateA || 0);
                    })[0];
                
                // Ordenar todos los contactos por fecha
                const sortedContacts = contacts.sort((a, b) => {
                    const dateA = parseDate(a.fecha);
                    const dateB = parseDate(b.fecha);
                    return (dateB || 0) - (dateA || 0);
                });
                
                return {
                    beneficiary,
                    contacts: sortedContacts,
                    lastSuccessfulContact: lastSuccessfulContact?.fecha || null
                };
            })
            .sort((a, b) => {
                // Ordenar por fecha del último contacto exitoso
                const daysA = getDaysSince(a.lastSuccessfulContact);
                const daysB = getDaysSince(b.lastSuccessfulContact);
                return daysB - daysA;
            });

        console.log('Follow-up data processed:', followUpArray);
        setFollowUpData(followUpArray);
    }, [callData]);

    const filteredData = useMemo(() => {
        return followUpData.filter(item => {
            // Aplicar búsqueda
            if (searchQuery && !item.beneficiary.toLowerCase().includes(searchQuery.toLowerCase())) {
                return false;
            }

            const lastContact = item.contacts[0]?.fecha;
            if (!lastContact) return activeFilter === 'urgent' || activeFilter === 'all';

            const days = Math.floor((new Date() - new Date(lastContact)) / (1000 * 60 * 60 * 24));

            switch (activeFilter) {
                case 'urgent':
                    return days >= 30;
                case 'warning':
                    return days >= 15 && days < 30;
                case 'ok':
                    return days < 15;
                default:
                    return true;
            }
        });
    }, [followUpData, activeFilter, searchQuery]);

    const counts = useMemo(() => {
        return followUpData.reduce((acc, item) => {
            const lastContact = item.contacts[0]?.fecha;
            const days = lastContact 
                ? Math.floor((new Date() - new Date(lastContact)) / (1000 * 60 * 60 * 24))
                : 999;

            acc.all++;
            if (days >= 30) acc.urgent++;
            else if (days >= 15) acc.warning++;
            else acc.ok++;

            return acc;
        }, { all: 0, urgent: 0, warning: 0, ok: 0 });
    }, [followUpData]);

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Historial de Seguimientos</h2>
                <div className="text-sm text-gray-500">
                    Total: {followUpData.length} beneficiarios
                </div>
            </div>

            <FilterTabs 
                activeFilter={activeFilter} 
                onFilterChange={setActiveFilter}
                counts={counts}
            />

            <SearchBar 
                value={searchQuery}
                onChange={setSearchQuery}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredData.map(({ beneficiary, contacts, lastSuccessfulContact }) => (
                    <BeneficiaryCard
                        key={beneficiary}
                        beneficiary={beneficiary}
                        contacts={contacts}
                        lastSuccessfulContact={lastSuccessfulContact}
                    />
                ))}
            </div>

            {filteredData.length === 0 && (
                <div className="text-center py-12">
                    <p className="text-gray-500">
                        {searchQuery 
                            ? 'No se encontraron beneficiarios que coincidan con la búsqueda'
                            : 'No hay beneficiarios en esta categoría'}
                    </p>
                </div>
            )}
        </div>
    );
}

export default FollowUpHistory;

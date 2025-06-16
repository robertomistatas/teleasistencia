import React from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend
);

const options = {
    responsive: true,
    plugins: {
        legend: {
            position: 'top',
        },
        title: {
            display: true,
            text: 'Llamadas por Hora'
        }
    },
    scales: {
        y: {
            beginAtZero: true,
            ticks: {
                precision: 0
            }
        }
    }
};

const BarChart = ({ data }) => {
    if (!data || !data.labels || !data.datasets) {
        return <div>No hay datos disponibles</div>;
    }

    return <Bar options={options} data={data} />;
};

export default React.memo(BarChart);

import axios from 'axios';

const apiClient = axios.create({
  baseURL: '',
});

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('trustvault_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('trustvault_token');
      localStorage.removeItem('trustvault_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;

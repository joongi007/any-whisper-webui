import axios from "axios";

export const apiClient = axios.create({ baseURL: "", timeout: 30_000 });

apiClient.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err.response?.data?.detail) {
      err.detailCode = err.response.data.detail.code;
      err.detailMessage = err.response.data.detail.message;
    }
    return Promise.reject(err);
  },
);

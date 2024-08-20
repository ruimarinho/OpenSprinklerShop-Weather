import * as moment from "moment-timezone";

import { GeoCoordinates, WeatherData } from "../../types";
import { httpJSONRequest } from "../weather";
import { WeatherProvider } from "./WeatherProvider";

interface Observation {
  intensidadeVentoKM: number;
  temperatura: number;
  radiacao: number;
  idDireccVento: number;
  precAcumulada: number;
  intensidadeVento: number;
  humidade: number;
  pressao: number;
}

interface StationGeometry {
  type: string;
  coordinates: [number, number];
}

interface StationProperties {
  idEstacao: number;
  localEstacao: string;
}

interface Station {
  geometry: StationGeometry;
  type: string;
  properties: StationProperties;
}

interface Location {
  idRegiao: number;
  idAreaAviso: string;
  idConcelho: number;
  globalIdLocal: number;
  latitude: string;
  idDistrito: number;
  local: string;
  longitude: string;
}

interface WeatherType {
  descWeatherTypeEN: string;
  descWeatherTypePT: string;
  idWeatherType: number;
}

export default class IPMAWeatherProvider extends WeatherProvider {

  private locations: Location[] | null;
  private stations: Station[] | null;
  private weatherType: WeatherType[] | null;

  /**
   * Api Docs from here: https://open-meteo.com/en/docs
   */
  public constructor() {
    super();

    this.locations = null;
    this.stations = null;
    this.weatherType = null;
  }

  public async getWeatherData(coordinates: GeoCoordinates): Promise< WeatherData > {

    console.log("IPMA getWeatherData request for coordinates: %s", coordinates);

    const location = await this.getClosestLocation(coordinates);
    const station = await this.getClosestStation(coordinates);
    const forecastUrl = `https://api.ipma.pt/open-data/forecast/meteorology/cities/daily/${location.globalIdLocal}.json`

    let forecast;
    try {
      forecast = await httpJSONRequest(forecastUrl);
    } catch (err) {
      console.error("Error retrieving weather information from IPMA:", err);
      throw "An error occurred while retrieving weather information from IPMA."
    }

    if (!forecast || !forecast.data) {
      throw "Necessary field(s) were missing from weather information returned by IPMA.";
    }

    const observationsUrl = "https://api.ipma.pt/open-data/observation/meteorology/stations/observations.json";

    let observations;
    try {
      observations = await httpJSONRequest(observationsUrl);
    } catch (err) {
      console.error("Error retrieving weather information from IPMA:", err);
      throw "An error occurred while retrieving weather information from IPMA."
    }

    const current = this.getLatestObservation(observations);
    const description = await this.getDescription(forecast.data[0].idWeatherType);

    const weather: WeatherData = {
      weatherProvider: "IPMA",
      temp: Math.floor(this.celsiusToFahrenheit(current[station.properties.idEstacao].temperatura)),
      humidity: current[station.properties.idEstacao].humidade,
      wind: Math.floor(this.kphToMph(current[station.properties.idEstacao].intensidadeVentoKM)),
      description,
      icon: this.getOWMIconCode(forecast.data[0].idWeatherType),
      region: location.local,
      city: station.properties.localEstacao,
      minTemp: Math.floor(this.celsiusToFahrenheit(forecast.data[0].tMin)),
      maxTemp: Math.floor(this.celsiusToFahrenheit(forecast.data[0].tMax)),
      precip: this.mmToInchesPerHour(current[station.properties.idEstacao].precAcumulada),
      forecast: [],
    };

    for (let day = 0; day < forecast.data.length; day++) {
      weather.forecast.push({
        temp_min: Math.floor(this.celsiusToFahrenheit(forecast.data[day].tMin)),
        temp_max: Math.floor(this.celsiusToFahrenheit(forecast.data[day].tMax)),
        date: Math.floor((new Date(`${forecast.data[day].forecastDate}T00:00:00Z`)).getTime() / 1000),
        icon: this.getOWMIconCode(forecast.data[day].idWeatherType),
        description: description,
      });
    }

    console.log("IPMA 2: temp:%s humidity:%s wind:%s",
      weather.temp,
      weather.humidity,
      weather.wind);

    return weather;
  }

  private async getClosestLocation(coordinates: GeoCoordinates): Promise<Location> {
    const locations = await this.getLocations();
    const allCoordinates: GeoCoordinates[] = locations.map(location => {
      return [parseFloat(location.latitude), parseFloat(location.longitude)] as GeoCoordinates;
    });
    const sortedByDistance = this.sortCoordinatesByDistance(coordinates, allCoordinates);

    return locations.find(location => {
      return (parseFloat(location.latitude) == sortedByDistance[0][0] && parseFloat(location.longitude) == sortedByDistance[0][1])
    });
  }

  private async getClosestStation(coordinates: GeoCoordinates): Promise<Station> {
    const stations = await this.getStations();

    const allCoordinates: GeoCoordinates[] = stations.map(station => {
      return [station.geometry.coordinates[1], station.geometry.coordinates[0]] as GeoCoordinates;
    });

    const sortedByDistance = this.sortCoordinatesByDistance(coordinates, allCoordinates);

    return stations.find(station => {
      return (station.geometry.coordinates[1] == sortedByDistance[0][0] && station.geometry.coordinates[0] == sortedByDistance[0][1])
    });
  }

  private calculateHaversineDistance(coordinate1: GeoCoordinates, coordinate2: GeoCoordinates): number {
      const R = 6371; // Earth's radius in kilometers
      const dLat = this.degreesToRadians(coordinate2[0] - coordinate1[0]);
      const dLon = this.degreesToRadians(coordinate2[1] - coordinate1[1]);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(this.degreesToRadians(coordinate1[0])) *
        Math.cos(this.degreesToRadians(coordinate2[0])) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
  }

  private degreesToRadians(degrees: number): number {
      return degrees * (Math.PI / 180);
  }

  private sortCoordinatesByDistance(baseCoord: GeoCoordinates, coordinates: GeoCoordinates[]): GeoCoordinates[] {
    return coordinates.sort((a, b) => {
      const distanceA = this.calculateHaversineDistance(baseCoord, a);
      const distanceB = this.calculateHaversineDistance(baseCoord, b);

      return distanceA - distanceB;
    });
  }

  private async getDescription(idWeatherType: number): Promise<string> {
    const weatherType = (await this.getWeatherTypes()).find(type => type.idWeatherType === idWeatherType);

    if (!weatherType) {
      return "";
    }

    return weatherType.descWeatherTypeEN;
  }

  private getOWMIconCode(idWeatherType: number) {
    switch(idWeatherType) {
      case -99:
      case 0:
        return "01d"; // No information or unknown -> Clear sky (default)
      case 1:
        return "01d"; // Clear sky
      case 2:
      case 25:
        return "02d"; // Partly cloudy
      case 3:
        return "03d"; // Sunny intervals
      case 4:
      case 27:
        return "04d"; // Cloudy
      case 5:
        return "02d"; // Cloudy (High cloud)
      case 6:
      case 9:
        return "09d"; // Showers/rain or Rain/showers
      case 7:
      case 13:
        return "10d"; // Light showers/rain or Intermittent light rain
      case 8:
      case 11:
      case 14:
        return "11d"; // Heavy showers/rain or Intermittent heavy rain
      case 10:
      case 12:
        return "10d"; // Light rain or Intermittent rain
      case 15:
        return "09d"; // Drizzle
      case 16:
      case 26:
        return "50d"; // Mist or Fog
      case 17:
        return "50d"; // Fog (Nevoeiro ou nuvens baixas)
      case 18:
        return "13d"; // Snow
      case 19:
      case 20:
      case 23:
        return "11d"; // Thunderstorms or Showers and thunderstorms or Rain and thunderstorms
      case 21:
        return "13d"; // Hail
      case 22:
        return "50d"; // Frost
      case 24:
        return "04d"; // Convective clouds
      case 28:
        return "13d"; // Snow showers
      case 29:
      case 30:
        return "13d"; // Rain and snow
      default:
        return "01d"; // Default to clear sky for any unknown id
    }
  }

  /**
   * Finds and returns the latest valid observation from a set of observations.
   * The observations are assumed to be in UTC time. The function compares
   * each observation's timestamp with the current UTC time and returns the
   * most recent observation, as the order provided by the API is random.
   *
   * @param {Object} observations - A collection of observations with timestamps as keys.
   * @returns {Object|null} - The latest valid observation data, or null if none are valid.
   */
  private getLatestObservation(observations: Observation[]): Observation {
    const now = moment().tz("UTC");

    let latestTimestamp = null;
    let latestData = null;

    for (const timestamp in observations) {
      // Convert the timestamp to a Date object
      const timestampMoment = moment.tz(timestamp, "UTC");

      // Check if the timestamp is before or equal to the current time
      if (timestampMoment.isSameOrBefore(now)) {
        if (latestTimestamp === null || timestampMoment.isAfter(latestTimestamp)) {
          latestTimestamp = timestampMoment;
          latestData = observations[timestamp];
        }
      }
    }

    return latestData;
  }

  private async getLocations(): Promise<Location[]> {
    if (null !== this.locations) {
      return this.locations;
    }

    let locations;
    try {
      locations = await httpJSONRequest("https://api.ipma.pt/open-data/distrits-islands.json");
    } catch (err) {
      console.error("Error retrieving weather information from IPMA:", err);
      throw "An error occurred while retrieving weather information from IPMA."
    }

    if (!locations || !locations.data) {
      throw "Necessary field(s) were missing from weather information returned by IPMA.";
    }

    return locations.data;
  }

  private async getStations(): Promise<Station[]> {
    if (null !== this.stations) {
      return this.stations;
    }

    let stations;
    try {
      stations = await httpJSONRequest("https://api.ipma.pt/open-data/observation/meteorology/stations/stations.json");
    } catch (err) {
      console.error("Error retrieving weather information from IPMA:", err);
      throw "An error occurred while retrieving weather information from IPMA."
    }

    if (!stations) {
      throw "Necessary field(s) were missing from weather information returned by IPMA.";
    }

    return stations;
  }

  private async getWeatherTypes(): Promise<WeatherType[]> {
    if (null !== this.weatherType) {
      return this.weatherType;
    }

    let weatherType;
    try {
      weatherType = await httpJSONRequest("https://api.ipma.pt/open-data/weather-type-classe.json");
    } catch (err) {
      console.error("Error retrieving weather information from IPMA:", err);
      throw "An error occurred while retrieving weather information from IPMA."
    }

    if (!weatherType || !weatherType.data) {
      throw "Necessary field(s) were missing from weather information returned by IPMA.";
    }

    return weatherType.data;
  }

  /**
   * Converts a temperature value from Celsius to Fahrenheit.
   * If the input is -99 (an error code), it returns 0.
   *
   * @param {number} celsius - The temperature in Celsius.
   * @returns {number} - The converted temperature in Fahrenheit.
   */
  private celsiusToFahrenheit(celsius) {
    if (celsius === -99) {
      return 0;
    }

    return (celsius * 9/5) + 32;
  }

  /**
   * Converts a precipitation rate from millimeters per hour to inches per hour.
   * If the input is -99 (an error code), it returns 0.
   *
   * @param {number} mmPerHour - The precipitation rate in millimeters per hour.
   * @returns {number} - The converted precipitation rate in inches per hour.
   */
  private mmToInchesPerHour(mmPerHour) {
    if (mmPerHour === -99) {
      return 0;
    }

    return mmPerHour * 0.03937007874;
  }

  /**
   * Converts a speed value from kilometers per hour to miles per hour.
   * If the input is -99 (an error code), it returns 0.
   *
   * @param {number} kph - The speed in kilometers per hour.
   * @returns {number} - The converted speed in miles per hour.
   */
  private kphToMph(kph) {
    if (kph === -99) {
      return 0;
    }

    return kph * 0.621371;
  }
}
